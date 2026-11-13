const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, '../..');
config.watchFolders = [path.join(root, 'shared'), path.join(root, 'src/controller'), path.join(root, 'src/network')];
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')];
// Keep nested Expo dependencies visible; shared modules contain no React imports.
config.resolver.extraNodeModules = {
  react: path.join(__dirname, 'node_modules/react'),
  'react-native': path.join(__dirname, 'node_modules/react-native'),
};
module.exports = config;
