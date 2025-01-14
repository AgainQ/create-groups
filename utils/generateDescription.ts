import OpenAI from 'openai';
import chalk from 'chalk';
import { OPENAI_API_KEY } from '../config';
import { descriptionExamples } from '../config';

const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// можно

function generatePrompt(topic: string) {
  const basePrompt = `Generate a suitable description in Russian language for social media group, where I am going to post short videos.\
    You should base your answer on 1) Topic of the group that needs description. 2) Multiple examples that include topic and description\
    But don't need to make it very similar to examples I provided, add some variety and randomness so it look unique. Also take into the account\
    that I am going to ask you to create descriptions for many groups, some of them have the same topic. So descriptions should not be very similar.
    Nevertheless each description you create must be suitable for social media group.\
    You can also add indentation paragraph indentation where it make sense, but not for every description..`;

  const examplesString = descriptionExamples
    .map(
      (example, i) =>
        `Topic of group ${i + 1} is ${example.topic}. Description is ${
          example.description
        }\n`
    )
    .join('\n');

  const prompt =
    basePrompt +
    `Topic of the group that needs description is ${topic}. Here are the examples you can use:\n\n${examplesString}`;

  // console.log(prompt);
  return prompt;
}

export async function generateDescription(topic: string) {
  const prompt = generatePrompt(topic);

  try {
    const chatCompletion = await client.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'gpt-4o',
    });

    const botMessage = chatCompletion.choices?.[0].message.content;
    // console.log(chalk.yellow('Bot:'), botMessage);
    return botMessage;
  } catch (err) {
    console.log(err);
    console.log('Failed to generate description');
    return null;
  }
}

// generateDescription('Рукоделие');
