import axios from 'axios';
import { Logger } from 'winston';

import fs from 'fs';
import path from 'path';
import { OPENAI_API_KEY } from '../config';

function generatePrompt(topic: string) {
  return `Generate a pfp picture for social media group with topic: ${topic}. \
  Style should be suitable for social media group, modern and looking good. \
  Photo must be pleasant to look at, it should not include any text, it should not have too much AI look`;
}

export async function generatePhoto(topic: string, outputPath: string, logger: Logger) {
  logger.info('2) Generating PFP');

  const prompt = generatePrompt(topic);

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const imageUrl = response.data.data[0].url;

    // Download and save the image
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
    });

    fs.writeFileSync(outputPath, imageResponse.data);
    logger.info(`PFP saved as ${path.basename(outputPath)}`);
  } catch (error) {
    // Log the error details. If error.response is available, use it.
    if (error.response) {
      logger.error('Error generating PFP:', {
        data: error.response.data,
        status: error.response.status,
      });
    } else {
      logger.error('Error generating PFP:', { message: error.message });
    }
    throw new Error(error);
  }
}
