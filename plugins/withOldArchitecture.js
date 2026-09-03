/**
 * Custom Expo config plugin to force Old Architecture (Bridge mode) on Android.
 * RN 0.86 defaults to New Architecture, but several of our native modules need OldArch.
 */
const { withGradleProperties } = require('@expo/config-plugins');

const withOldArchitecture = (config) => {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;
    const newArchProp = props.find(
      (p) => p.type === 'property' && p.key === 'newArchEnabled'
    );
    if (newArchProp) {
      newArchProp.value = 'false';
    } else {
      props.push({ type: 'property', key: 'newArchEnabled', value: 'false' });
    }
    return config;
  });
};

module.exports = withOldArchitecture;