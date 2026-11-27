// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
  {
    rules: {
      // A package-root import bundles every icon set / font weight into the
      // APK (56 fonts, 6.5 MB, before this rule). Import one file instead.
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: '@expo/vector-icons', message: "Import one set, e.g. '@expo/vector-icons/MaterialCommunityIcons'." }],
          patterns: [{ regex: '^@expo-google-fonts/[^/]+$', message: "Import one weight, e.g. '@expo-google-fonts/inter/400Regular'." }],
        },
      ],
    },
  },
]);
