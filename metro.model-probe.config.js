const { mergeConfig } = require('@react-native/metro-config');
const base = require('./metro.config');

// Opt-in fixture app; normal Metro configuration and the production entry are unchanged.
module.exports = mergeConfig(base, {
  server: {
    rewriteRequestUrl: url => url.replace(/\/index\.bundle(?=\?|$)/, '/index.model-probe.bundle'),
  },
});
