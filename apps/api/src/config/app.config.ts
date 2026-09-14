import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  host: process.env.NAVFARM_API_HOST || '0.0.0.0',
  port: parseInt(process.env.NAVFARM_API_PORT || process.env.PORT || '2877', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
}));
