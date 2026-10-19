/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { getStartupComponent } from './src/app/startup';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, getStartupComponent);
