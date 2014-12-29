/* This adds a worker that helps our shot pages */
var self = require("sdk/self");
var tabs = require("sdk/tabs");
var simplePrefs = require('sdk/simple-prefs');
var { captureTab } = require("./screenshot.js");
var pageMod = require("sdk/page-mod");
var clipboard = require("sdk/clipboard");
var notifications = require("sdk/notifications");
var { addHash } = require("hashlist");
var { XMLHttpRequest } = require("sdk/net/xhr");

var existing;

function resetPageMod(backend) {
  backend = backend || simplePrefs.prefs.backend;
  if (existing) {
    existing.destroy();
  }
  var include = backend.replace(/^https?:\/\//, "");
  include = include.replace(/\/.*/, "");
  include = include.replace(/:.*/, "");
  include = "*." + include;
  existing = pageMod.PageMod({
    include: include,
    contentScriptFile: [self.data.url("viewerworker.js")],
    onAttach: function (worker) {
      worker.port.on("requestScreenshot", function (info) {
        var image = captureTab(worker.tab, info);
        worker.port.emit("screenshot", image, info);
      });
      worker.port.on("requestClipboard", function (info) {
        if (info.text) {
          clipboard.set(info.text, "text");
        }
        if (info.image) {
          clipboard.set(info.image, "html");
        }
        if (info.html) {
          clipboard.set(info.html, "html");
        }
        if (info.confirmationMessage) {
          notifications.notify({
            title: info.confirmationTitle,
            text: info.confirmationMessage,
            iconURL: backend + "/clipboard-8-xl.png"
          });
        }
      });
      worker.port.on("addTags", function (tags) {
        tags.forEach(function (tag) {
          addHash(tag);
        });
      });
      worker.port.on("checkCaptured", function (pageInfo) {
        var captured = pageInfo.captured;
        var path = pageInfo.path;
        var url = pageInfo.url;
        var req = new XMLHttpRequest();
        // This scratch URL stuff is because the browser is fulfilling
        // requests with a 200 response even when it gets a 304
        // upstream, even though it is not supposed to do so when a
        // cache header is explicitly set.
        var scratchUrl = url;
        if (url.indexOf('?') == -1) {
          scratchUrl += '?';
        } else {
          scratchUrl += '&';
        }
        scratchUrl += '_cachebreak=' + Math.random();
        req.open("HEAD", scratchUrl);
        req.setRequestHeader("If-Modified-Since", ((new Date(captured)).toUTCString()));
        req.onload = function () {
          worker.port.emit("checkCapturedResult", {
            path: path,
            url: url,
            captured: captured,
            status: req.status
          });
        };
        req.send();
      });
    }
  });
}

exports.trackMods = function (backendOverride) {
  resetPageMod(backendOverride);
  simplePrefs.on("backend", function () {
    resetPageMod(simplePrefs.prefs.backend);
  });
};