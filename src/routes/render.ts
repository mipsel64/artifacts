import { Hono } from 'hono';
import type { AppEnv } from '../types';

const routes = new Hono<AppEnv>();

export default routes;
