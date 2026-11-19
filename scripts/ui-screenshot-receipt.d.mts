export function decideReceipt(input: {
  filePath: string;
  hasPlaywright: boolean;
}): { run: false; message: string } | { run: true; command: string; args: string[] };
