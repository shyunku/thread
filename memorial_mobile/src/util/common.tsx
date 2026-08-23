import PackageJSON from '../../package.json';

const YEAR = 365 * 24 * 60 * 60 * 1000;
const MONTH = 30 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const SECOND = 1000;

export function getServerEndpoint() {
  const SERVER_ENDPOINT_URL = PackageJSON.config.app_server_endpoint;
  const SERVER_API_VERSION = PackageJSON.config.app_server_api_version;
  const SERVER_ENDPOINT = `${SERVER_ENDPOINT_URL}/${SERVER_API_VERSION}`;
  return SERVER_ENDPOINT;
}

export function fastInterval(
  callback: () => void,
  interval: number | undefined,
) {
  callback();
  let id = setInterval(callback, interval);
  return id;
}

export const colorize = {
  red: (text: any) => `\x1b[31m${text}\x1b[0m`,
  green: (text: any) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text: any) => `\x1b[33m${text}\x1b[0m`,
  blue: (text: any) => `\x1b[34m${text}\x1b[0m`,
  magenta: (text: any) => `\x1b[35m${text}\x1b[0m`,
  cyan: (text: any) => `\x1b[36m${text}\x1b[0m`,
  white: (text: any) => `\x1b[37m${text}\x1b[0m`,
  gray: (text: any) => `\x1b[90m${text}\x1b[0m`,
};

// relative time to relative time text
const defaultOptions = {
  showLayerCount: 4,
  showMillisec: false,
};
export const fromRelativeTime = (
  milli: number,
  rawOptions = defaultOptions,
) => {
  if (milli == null) return '-';
  let inversed = milli < 0;
  if (inversed) milli = -milli;

  const options = {...defaultOptions, ...rawOptions};

  const year = Math.floor(milli / YEAR);
  milli %= YEAR;
  const month = Math.floor(milli / MONTH);
  milli %= MONTH;
  const day = Math.floor(milli / DAY);
  milli %= DAY;
  const hour = Math.floor(milli / HOUR);
  milli %= HOUR;
  const min = Math.floor(milli / MINUTE);
  milli %= MINUTE;
  const sec = Math.floor(milli / SECOND);
  milli %= SECOND;
  const msec = milli;

  const segments = [
    {value: year, unit: '년'},
    {value: month, unit: '개월'},
    {value: day, unit: '일'},
    {value: hour, unit: '시간'},
    {value: min, unit: '분'},
    {value: sec, unit: '초'},
    {value: msec, unit: '밀리초'},
  ];

  const showLayerCount = options?.showLayerCount ?? 0;

  const texts = [];
  let flag = false;
  for (let i = 0, j = 0; i < segments.length; i++) {
    const {value, unit} = segments[i];
    if (options?.showMillisec === false && unit === '밀리초') continue;
    if (value > 0 || flag) {
      let valText =
        unit === '밀리초' ? value.toString().padStart(3, '0') : value;
      texts.push(`${valText}${unit}`);
      j++;
      flag = true;
    }
    if (showLayerCount && j >= showLayerCount) break;
  }
  if (texts.length === 0) texts.push('0초');

  return (inversed ? '-' : '') + texts.join(' ');
};
