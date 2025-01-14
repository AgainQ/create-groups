import axios, { AxiosInstance } from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import randomUseragent from 'random-useragent';
import { Logger } from 'winston';

import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

import { createAccountLogger } from './logger';
import { sleep } from './utils/utils';
import { generatePhoto } from './utils/generatePhoto';
import { generateDescription } from './utils/generateDescription';
import { solveCaptcha } from './utils/solveCaptcha';
import { RawAccount, VKgroup } from './types';
import {
  DELAY_BETWEEN_ACCOUNTS_START,
  DELAY_BETWEEN_GROUPS_CREATION,
  INPUT_FILEPATH,
} from './config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resultsDir = path.join(__dirname, 'results');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir);
}

class VKaccount {
  name: string;
  cookie: string;
  proxy: string;
  groups: VKgroup[];
  accessToken: string | null = null;
  axiosInstance: AxiosInstance;
  logger: Logger;
  #resultsPath: string;

  constructor(account: RawAccount) {
    this.name = account.name;
    this.cookie = account.cookie;
    this.proxy = account.proxy;
    this.groups = account.groups;

    this.logger = createAccountLogger(this.name);

    // Use the account's name to generate a unique file name
    this.#resultsPath = path.join(resultsDir, `${this.name.replace(/\s+/g, '_')}.csv`);
    // If this file does not exist, create it and write header
    if (!fs.existsSync(this.#resultsPath)) {
      fs.writeFileSync(this.#resultsPath, 'GroupName,Topic,GroupID,URL,PhotoStatus\n');
    }

    const proxyAgent = new SocksProxyAgent(this.proxy);
    this.axiosInstance = axios.create({
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
      headers: { 'User-Agent': randomUseragent.getRandom() },
    });
  }

  // ######### UTILS #########
  async checkProxy() {}

  async updateToken(): Promise<string> {
    this.logger.info(`Updating token for account`);

    const headers = {
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
      Cookie: this.cookie,
      Origin: 'https://vk.com',
      Priority: 'u=1, i', // Optional: you can remove if not needed.
      Referer: 'https://vk.com/',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const body = new URLSearchParams({
      version: '1',
      app_id: '6287487', // default for all accounts
    });
    const url = 'https://login.vk.com/?act=web_token';

    try {
      const { data } = await this.axiosInstance.post(url, body, { headers });
      const accessToken = data?.data?.access_token;
      if (!accessToken) {
        throw new Error('No access_token returned from VK.');
      }
      this.logger.info(`Updated token for account`);
      this.accessToken = accessToken;
      return accessToken;
    } catch (error: any) {
      if (error.response) {
        this.logger.error('Error Response', {
          data: error.response.data,
          status: error.response.status,
          headers: error.response.headers,
        });
      } else if (error.request) {
        this.logger.error('No response received', { request: error.request });
      } else {
        this.logger.error('Error', { message: error.message });
      }
      throw error;
    }
  }

  // ######### CREATE GROUPS #########
  async createGroups() {
    for (const [i, group] of this.groups.entries()) {
      this.logger.info(`Starting processing group number <${i + 1}>`);
      await this.updateToken();

      await this.createGroup(group);
      await sleep(DELAY_BETWEEN_GROUPS_CREATION, 'delay between groups creation');
    }

    this.logger.info(`-------------------------------------------------`);
    this.logger.info(`All groups have been processed for account ${this.name}.`);
  }

  private async createGroup(group: VKgroup) {
    const { name, topic } = group;
    let csvData = '';
    try {
      // 1. Generate group description
      const description = (await generateDescription(topic)) || '';

      // 2. Create the base group
      const groupData = await this.createBaseGroup(name, description);

      if (!groupData || !groupData.groupId) {
        // Scenario 1: Failed to create base group: write only GroupName,Topic
        csvData = `${name},${topic}\n`;
        this.logger.error(`Base group creation failed for group: ${name}`);
        fs.appendFileSync(this.#resultsPath, csvData);
        return;
      }

      // If we get here, base group is created successfully
      const { groupId, screenName } = groupData;

      // 3. Generate photo for the group
      const photoPath = path.resolve(__dirname, 'img', `${groupId}.png`);
      await generatePhoto(topic, photoPath, this.logger);

      // 4. Update the group photo. You can wrap this in try/catch to check for errors.
      const photoUpdateSuccess = await this.updateGroupPhoto(groupId, photoPath);

      // Remove the temporary photo file regardless of update success
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
      const groupUrl = `https://vk.com/${screenName}`;
      const photoStatus = photoUpdateSuccess ? 'have-photo' : 'no-photo';
      csvData = `${name},${topic},${groupId},${groupUrl},${photoStatus}\n`;
      fs.appendFileSync(this.#resultsPath, csvData);

      this.logger.info(`Finished processing group: ${name} with status: ${photoStatus}`);
    } catch (err: any) {
      // In case of any unforeseen errors, you could also log the error to the CSV.
      this.logger.error(`Error processing group: ${name}`, { error: err.message });
      // Optionally log a failure CSV entry (if that makes sense for your use case).
      if (!csvData) {
        csvData = `${name},${topic}\n`;
        fs.appendFileSync(this.#resultsPath, csvData);
      }
    } finally {
      this.logger.info(`-------------------------------------------------`);
    }
  }

  private async createBaseGroup(title: string, description: string) {
    this.logger.info(`1) Creating base group: ${title}`);

    const url = 'https://api.vk.com/method/groups.create';
    let params: any = {
      access_token: this.accessToken,
      v: '5.131',
      title,
      description,
      type: 'group', // public | group
      subtype: 2, // only for public
    };

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        sleep('10 seconds');
        const { data } = await this.axiosInstance.get(url, { params });

        if (data?.error?.error_msg === 'Captcha needed') {
          const { captcha_img, captcha_sid } = data.error;
          this.logger.warn('Captcha required. Solving...');

          const captcha_key = await solveCaptcha(captcha_img, this.logger);
          if (!captcha_key) throw new Error('Failed to solve captcha.');

          params = { ...params, captcha_key, captcha_sid };
          continue; // Retry with captcha
        }

        if (data?.error?.error_code === 5) {
          this.logger.error('Authorization error. Token was given to another ip.');
          // return 'Authorization error';
          return;
        }
        if (data?.error?.error_msg === 'Flood control') {
          this.logger.error('Flood control error. Better to sleep long.');
          // return 'Flood control';
          return;
        }
        if (data?.error?.error_msg === 'Anonymous token is invalid') {
          this.logger.error('Error in token');
          // return 'Error in token';
          return;
        }

        const groupId: number = data.response?.id;
        const screenName: string = data.response?.screen_name;
        if (groupId) {
          this.logger.info(`Created base group (${title}) with ID: ${groupId}`);
          return { groupId, screenName };
        }

        this.logger.error('Failed to extract group ID from response.');
        // return null;
      } catch (err) {
        // prettier-ignore
        this.logger.error(`Error creating base group (${title}):`, { error: err.message });
        return null;
      }
    }

    this.logger.error('Max captcha attempts reached.');
    return null;
  }

  // ######### UPDATE GROUP PHOTO #########
  async updateGroupPhoto(groupId: number, photoPath: string) {
    this.logger.info(`3) Updating group's photo`);

    try {
      const uploadUrl = await this.getUploadServer(groupId);
      this.logger.info('--Obtained upload server URL.');

      const uploadData = await this.uploadPhoto(uploadUrl, photoPath);
      this.logger.info('--Photo uploaded successfully.');

      const savePhotoResponse = await this.savePhoto(groupId, uploadData);
      if (savePhotoResponse.saved) {
        this.logger.info('Group photo updated successfully');
        return true;
      } else {
        this.logger.error('Group photo update failed: Photo was not saved successfully.');
        return false;
      }
    } catch (error: any) {
      this.logger.error('Failed to update group photo:', { error: error.message });
      return false;
    }
  }

  private async getUploadServer(groupId: number): Promise<string> {
    const url = 'https://api.vk.com/method/photos.getOwnerPhotoUploadServer';
    const params = {
      owner_id: -groupId,
      access_token: this.accessToken,
      v: '5.131',
    };

    const { data } = await this.axiosInstance.get(url, { params });

    if (data.error) {
      throw new Error(`Error getting upload server: ${JSON.stringify(data.error)}`);
    }

    return data.response.upload_url;
  }

  private async uploadPhoto(uploadUrl: string, photoPath: string): Promise<any> {
    const formData = new FormData();
    formData.append('photo', fs.createReadStream(photoPath));

    const { data } = await this.axiosInstance.post(uploadUrl, formData, {
      headers: formData.getHeaders(),
    });

    if (data.error) {
      throw new Error(`Error uploading photo: ${JSON.stringify(data.error)}`);
    }

    return data;
  }

  private async savePhoto(groupId: number, uploadData: any): Promise<any> {
    const url = 'https://api.vk.com/method/photos.saveOwnerPhoto';
    const params = {
      owner_id: -groupId,
      server: uploadData.server,
      hash: uploadData.hash,
      photo: uploadData.photo,
      access_token: this.accessToken,
      v: '5.131',
    };

    const { data } = await this.axiosInstance.get(url, { params });

    if (data.error) {
      throw new Error(`Error saving photo: ${JSON.stringify(data.error)}`);
    }

    return data.response;
  }
}

function initAccounts() {
  const fileContent = fs.readFileSync(INPUT_FILEPATH, 'utf-8');
  const rawAccounts: RawAccount[] = JSON.parse(fileContent);
  const accounts = rawAccounts.map(account => new VKaccount(account));
  console.log(chalk.green(`< ${accounts.length}pc > Accounts were initiated`));
  return accounts;
}

async function main() {
  const accounts = initAccounts();

  for (const [i, account] of accounts.entries()) {
    console.log(`Starting account number ${i + 1} (${account.name})`);
    account.createGroups();
    await sleep(DELAY_BETWEEN_ACCOUNTS_START, 'delay between accounts start');
  }

  console.log(chalk.green('All groups for all accounts have been processed.'));
}

main();

// abs Путь файла, куда сохранять результаты
// но надо подумать сначала как сохранять. Мб сделать папку results.
// И там текстовые файлы. 1 аккаунт = 1 файл
// const resultsPath = path.join(__dirname, 'results' ,'results.txt');
// имя .txt файла должно быть кастомное, по имени аккаунта

// ------------------------------------------------------------------
