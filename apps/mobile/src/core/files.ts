import { Buffer } from 'buffer';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  keepLocalCopy,
  pick,
  saveDocuments,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';
import {
  CachesDirectoryPath,
  readFile,
  unlink,
  writeFile,
} from '@dr.pogodin/react-native-fs';

// Recovery files (.trec) leave the app only through the system save dialog
// (Downloads, Google Drive, ...) and come back through the system file picker.
// Temporary copies live in the app cache and are removed right after use.

const MAX_RECOVERY_FILE = 1024 * 1024;

export async function saveRecoveryFile(
  bytes: Buffer,
  fileName = 'thread_recovery.trec',
): Promise<boolean> {
  const path = `${CachesDirectoryPath}/${Date.now()}-${fileName}`;
  await writeFile(path, bytes.toString('base64'), 'base64');
  try {
    const [result] = await saveDocuments({
      sourceUris: [`file://${path}`],
      fileName,
      mimeType: 'application/octet-stream',
    });
    return !!result?.uri && !result.error;
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED)
      return false;
    throw error;
  } finally {
    await unlink(path).catch(() => {});
  }
}

export async function pickRecoveryFile(): Promise<{
  name: string;
  bytes: Buffer;
} | null> {
  let picked;
  try {
    [picked] = await pick({ mode: 'open' });
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED)
      return null;
    throw error;
  }
  const name = picked.name ?? 'recovery.trec';
  if (!/\.trec$/i.test(name)) throw Error('INVALID_RECOVERY_FILE_EXTENSION');
  if (picked.size != null && picked.size > MAX_RECOVERY_FILE)
    throw Error('INVALID_RECOVERY_FILE');
  const [copy] = await keepLocalCopy({
    files: [{ uri: picked.uri, fileName: `import-${Date.now()}.trec` }],
    destination: 'cachesDirectory',
  });
  if (copy.status !== 'success') throw Error('INVALID_RECOVERY_FILE');
  const path = decodeURI(copy.localUri.replace(/^file:\/\//, ''));
  try {
    const bytes = Buffer.from(await readFile(path, 'base64'), 'base64');
    if (bytes.length > MAX_RECOVERY_FILE) throw Error('INVALID_RECOVERY_FILE');
    return { name, bytes };
  } finally {
    await unlink(path).catch(() => {});
  }
}

// Copies text and clears it after 30 seconds if it is still the clipboard content (desktop rule).
export function copySecret(text: string) {
  Clipboard.setString(text);
  setTimeout(async () => {
    try {
      if ((await Clipboard.getString()) === text) Clipboard.setString('');
    } catch {}
  }, 30000);
}
