/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import PackageJSON from './package.json';
import {APP_SERVER_ENDPOINT} from '@env';
import axios from 'axios';
import 'react-native-get-random-values';

const SERVER_API_VERSION = PackageJSON.config.app_server_api_version;
const SERVER_ENDPOINT = `${APP_SERVER_ENDPOINT}/${SERVER_API_VERSION}`;

// set axios default base URL
axios.defaults.baseURL = SERVER_ENDPOINT;

AppRegistry.registerComponent(appName, () => App);
