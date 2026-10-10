// يجمع منطق الخادم نفسه ليعمل داخل المتصفح في وضع العرض التجريبي (بدون خادم)
import pitch from "../api/pitch.js";
import feed from "../api/feed.js";
import hack from "../api/hack.js";
import config from "../api/config.js";
import admin from "../api/admin.js";
import files from "../api/files.js";
export const handlers = { pitch, feed, hack, config, admin, files };
