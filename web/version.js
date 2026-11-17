'use strict';
// The one place the web version is written. The page (index.html) and the service worker (sw.js, importScripts) both
// read it: the SW cache name is 'bn-web-' + WEB_VERSION, so bumping this line refreshes every installed copy.
self.WEB_VERSION = '4.2.8';
