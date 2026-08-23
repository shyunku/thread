/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import PackageJSON from './package.json';
import axios from 'axios';
import 'react-native-get-random-values';

const SERVER_ENDPOINT_URL = PackageJSON.config.app_server_endpoint;
const SERVER_API_VERSION = PackageJSON.config.app_server_api_version;
const SERVER_ENDPOINT = `${SERVER_ENDPOINT_URL}/${SERVER_API_VERSION}`;

// set axios default base URL
axios.defaults.baseURL = SERVER_ENDPOINT;

AppRegistry.registerComponent(appName, () => App);
