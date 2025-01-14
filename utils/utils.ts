import ms from 'ms';
import chalk from 'chalk';

export async function sleep(time: string, text?: string) {
  const milliseconds = ms(time);
  if (milliseconds === undefined) {
    throw new Error(`Invalid time format: "${time}"`);
  }

  console.log(
    chalk.grey(`Sleeping: ${time} |`),
    text !== undefined ? chalk.grey(text) : ''
  );
  return new Promise(resolve => {
    setTimeout(resolve, ms(time));
  });
}
