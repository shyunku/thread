// Prints a random alphanumeric passphrase (default 18 characters) for signing keys.
const { generatePassphrase } = require('./updateSigningSecrets.cjs');

try {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length > 1 || (args.length === 1 && !/^\d+$/.test(args[0])))
    throw Error('USAGE_GENERATE_PASSPHRASE_[LENGTH]');
  const value = generatePassphrase(args.length ? Number(args[0]) : undefined);
  console.log(value.toString('ascii'));
  value.fill(0);
} catch (error) { console.error(error.message); process.exitCode = 1; }
