import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'winston';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { CAPTCHA_GURU_API_KEY } from '../config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Функция для скачивания изображения капчи
async function downloadCaptchaImage(url: string, outputPath: string, logger?: Logger) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(outputPath, response.data);
    logger?.info(`Captcha saved as ${outputPath}`) ||
      console.log(`Captcha saved as ${outputPath}`);
  } catch (error) {
    logger?.error('Error downloading captcha image:', { error: error.message }) ||
      console.error('Error downloading captcha image:', error.message);
    throw error;
  }
}

// Функция для преобразования изображения в base64
function imageToBase64(filePath: string, logger?: Logger) {
  try {
    const imageBuffer = fs.readFileSync(filePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    logger?.error('Error converting image to base64', { error: error.message }) ||
      console.error('Error converting image to base64:', error.message);
    throw error;
  }
}

// Функция для решения текстовой капчи
export async function solveCaptcha(imageUrl: string, logger?: Logger) {
  const captchaPath = path.resolve(__dirname, `${uuidv4()}.png`); // Путь для сохранения капчи

  try {
    // Шаг 1: Скачивание капчи
    await downloadCaptchaImage(imageUrl, captchaPath, logger);

    // Шаг 2: Преобразование капчи в base64
    const base64Image = imageToBase64(captchaPath, logger);

    // Проверка base64Image
    if (!base64Image) {
      throw new Error('Не удалось преобразовать изображение в base64.');
    }

    // Шаг 3: Отправка капчи на Captcha.guru
    const params = new URLSearchParams();
    params.append('key', CAPTCHA_GURU_API_KEY);
    params.append('method', 'base64');
    params.append('body', base64Image);
    // В Python примере не используется 'json', поэтому убираем его

    const response = await axios.post('http://api.cap.guru/in.php', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    // Проверка ответа от Captcha.guru
    if (!response.data || typeof response.data !== 'string') {
      logger?.error('Error sending captcha', { response: response.data }) ||
        console.error('Error sending captcha:', response.data);
      return;
    }

    const parts = response.data.split('|');
    if (parts[0] !== 'OK') {
      console.error('Ошибка при отправке капчи:', response.data);
      return;
    }

    const requestId = parts[1];
    logger?.info(`Captcha sent. Request ID: ${requestId}`) ||
      console.log(`Captcha sent. Request ID: ${requestId}`);

    // Шаг 4: Ожидание решения
    let solved = false;
    let result: string | undefined;

    while (!solved) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Ожидание 5 секунд перед проверкой

      try {
        const res = await axios.get(
          `http://api.cap.guru/res.php?key=${CAPTCHA_GURU_API_KEY}&action=get&id=${requestId}`
        );

        if (!res.data || typeof res.data !== 'string') {
          // prettier-ignore
          logger?.error('Unexpected response during captcha polling', { response: res.data }) ||
           console.error('Unexpected response during captcha polling:', res.data);
          return;
        }

        if (res.data === 'CAPCHA_NOT_READY') {
          logger?.info('Captcha not ready yet, checking again...') ||
            console.log('Captcha not ready yet, checking again...');
        } else {
          const resParts = res.data.split('|');
          if (resParts[0] === 'OK') {
            result = resParts[1];
            solved = true;
          } else {
            logger?.error('Error solving captcha', { response: res.data }) ||
              console.error('Error solving captcha:', res.data);
            return;
          }
        }
      } catch (error) {
        // prettier-ignore
        logger?.error('Error while polling for captcha solution', { error: error.message }) ||
         console.error('Error while polling for captcha solution:', error.message);
        return;
      }
    }

    logger?.info(`Captcha solved: ${result}`) || console.log(`Captcha solved: ${result}`);
    return result;
  } catch (error) {
    logger?.error('An error occurred in solveCaptcha', { error: error.message }) ||
      console.error('An error occurred in solveCaptcha:', error.message);
  } finally {
    // Опционально: удаление локального файла капчи после решения
    if (fs.existsSync(captchaPath)) {
      fs.unlinkSync(captchaPath);
      logger?.info('Local captcha image deleted.') ||
        console.log('Local captcha image deleted.');
    }
  }
}

// Вызов функции для решения капчи
// const captchaUrl = 'https://vk.com/captcha.php?sid=298327211784';
// solveCaptcha(captchaUrl);
