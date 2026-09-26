/** Version of the build, injected by Vite: short commit and package version; "dev" outside a build (tests). */
declare const __APP_VERSION__: string | undefined;
declare const __APP_SEMVER__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';
export const APP_SEMVER: string = typeof __APP_SEMVER__ === 'string' && __APP_SEMVER__ ? __APP_SEMVER__ : 'dev';

/** "0.9.0 (commit abc1234)", shown in the footer and written to the Rastreabilidade tab. */
export const APP_VERSION_LABEL = APP_SEMVER === 'dev' ? 'dev' : `${APP_SEMVER} (commit ${APP_VERSION})`;
