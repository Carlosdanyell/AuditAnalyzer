/** Version of the build (short commit), injected by Vite; "dev" outside a build (tests, dev server without git). */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';
