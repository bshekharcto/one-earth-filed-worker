import { registerRootComponent } from 'expo';

// MUST be imported before App so TaskManager.defineTask() runs at module scope.
// The OS can relaunch the app straight into the background task, and the task
// has to already be registered at that point or the fixes are dropped.
import './src/services/backgroundLocationTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
