const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  externals: [
    {
      'swagger-ui-dist/absolute-path.js':
        'commonjs swagger-ui-dist/absolute-path.js',
      // One class-transformer for the whole process (13 Oct). Bundled, the DTOs registered their @Type/@Transform
      // rules in the bundled ESM copy while Nest's ValidationPipe loads the node_modules CommonJS copy, which has
      // its own metadata store: every rule was ignored in the built API. Nested rows (KPI lines) came out as
      // arrays and were saved as [], and @Transform (blank -> null, MONTHLY -> WEEKLY) never ran. Tests and
      // ts-node share one copy, so only the build was wrong.
      'class-transformer': 'commonjs class-transformer',
      'class-transformer/storage': 'commonjs class-transformer/cjs/storage',
    },
  ],
  resolve: {
    alias: {
      'class-transformer/storage': require.resolve(
        'class-transformer/cjs/storage',
        { paths: [__dirname] },
      ),
    },
  },
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets', './src/drizzle'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
      // Nest Swagger asks this helper for the on-disk UI asset directory.
      // Bundling it changes `__dirname` to apps/api/dist and makes every
      // Swagger CSS/JS request return 404.
      mergeExternals: true,
    }),
  ],
};
