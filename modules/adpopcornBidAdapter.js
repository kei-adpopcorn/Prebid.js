import * as utils from '../src/utils.js';
import {parse as parseUrl} from '../src/url.js';
import {config} from '../src/config.js';
import {registerBidder} from '../src/adapters/bidderFactory.js';
import {BANNER} from '../src/mediaTypes.js';
import {getStorageManager} from '../src/storageManager.js';

const SERVER = 'ssp-web-request.igaw.io';
const BANNER_API_ENDPOINT = '/v1/rev1/banner';
const COOKIE_NAME = '__igaw__adid';
const VERSION = {
  pbjs: '$prebid.version$',
  adapter: '1.0.2',
};

const storage = getStorageManager();
export const spec = {
  code: 'adpopcorn',
  aliases: ['ap'],
  supportedMediaTypes: [BANNER],
  /**
   * Determines whether or not the given bid request is valid.
   * @param {Object} bid
   * @param {Object} bid.params
   * @returns {Boolean}
   */
  isBidRequestValid({ params: { publisherId, placementId } = {} } = {}) {
    return !!(publisherId && placementId);
  },
  /**
   * Make a server request from the list of BidRequests.
   * @param {Array} bids
   * @param {Object} bidderRequest
   * @returns {Array}
   */
  buildRequests(bids, { refererInfo = {} } = {}) {
    const requests = [];
    const bannerBids = bids.filter(isBannerBid);

    const { width, height } = screen;
    const tzOffset = -new Date().getTimezoneOffset();
    const adids = getAdids(storage.getCookie(COOKIE_NAME) || '');
    const dspid = {};
    const ua = new Ua(navigator.userAgent);
    const device = ua.device()
    const os = ua.os()
    const browser = ua.browser();
    browser.dnt = utils.getDNT();
    browser.language = (navigator.language || navigator.userLanguage).substring(0, 2);

    const position = { x: 0, y: 0 }; // reserved
    const site = getSiteInfo(refererInfo);

    // extract dsp id
    for (const k in adids) {
      if (k !== "000") {
        dspid[k] = adids[k];
      }
    }

    // banner
    bannerBids.forEach(({
      bidId,
      params: {
        publisherId,
        placementId,
        external = {},
        bcat = [],
      },
      mediaTypes: {
        banner: {
          sizes: [[ w, h ]] = [[ 0, 0 ]],
        },
      },
    }) => {
      requests.push({
        method: 'POST',
        url: `https://${getApiServer()}${BANNER_API_ENDPOINT}`,
        options: {
          contentType: 'application/json',
          withCredentials: false,
        },
        data: {
          publisherId,
          placementId,
          external,
          dspid,
          width,
          height,
          device,
          os,
          browser,
          tzOffset,
          position,
          site,
          bcat,
          adid: adids['000'],
          bannerSize: `${w}x${h}`,
          ua: ua.toString(),
          version: VERSION,
        },
        bidId,
      });
    });

    return requests;
  },
  /**
   * Unpack the response from the server into a list of bids.
   * @param {Object} serverResponse
   * @param {Object} serverResponse.body
   * @param {Object} request
   * @param {Object} request.bid
   * @returns {Array}
   */
  interpretResponse({ body: { Result: ok, IsTest: isTest, AdList: ads = [] } = {} }, { bidId }) {
    if (!ok) {
      return [];
    }

    return ads.map(ad => {
      const requestId = bidId;
      const netRevenue = true;
      const ttl = 60;
      const {
        bid_price: cpm,
        bid_currency: currency = 'USD',
        creative_id: creativeId = bidId,
        width,
        height,
      } = ad;

      return {
        requestId,
        cpm,
        currency,
        creativeId,
        width,
        height,
        netRevenue,
        ttl,
        ad: getAdMarkup(ad),
        adpopcorn: {
          isTest,
        },
      };
    });
  },
  /**
   * Register the user sync pixels which should be dropped after the auction.
   * @param {Object} syncOptions
   * @param {Boolean} syncOptions.iframeEnabled
   * @returns {Array}
   */
  getUserSyncs({ iframeEnabled }) {
    if (iframeEnabled) {
      return [{
        type: 'iframe',
        url: `https://ssp.igaw.io/usersync.html`,
      }];
    }
  },
};

registerBidder(spec);

function isBannerBid(bid) {
  return utils.deepAccess(bid, 'mediaTypes.banner');
}

function getApiServer() {
  return config.getConfig('adpopcorn.server') || SERVER;
}

function getAdids(cookie, adids = {}) {
  let ds = "";

  try {
    ds = b64decode(cookie);
  } catch (ex) {
    if (cookie.indexOf('-') >= 0) {
      ds = `000=${cookie}`;
    }
  }

  [].forEach.call(ds.split(';'), value => {
    if (value !== "") {
      const parts = decodeURIComponent(value).split('=');

      adids[parts[0]] = parts[1];
    }
  });

  return adids;
}

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function b64decode(input) {
  if ('atob' in window) {
    return atob(input);
  }

  const str = (String(input)).replace(/[=]+$/, ''); // #31: ExtendScript bad parse of /=
  let output = '';

  if (str.length % 4 === 1) {
    throw new InvalidCharacterError("'atob' failed: The string to be decoded is not correctly encoded.");
  }
  for (
    // initialize result and counters
    let bc = 0, bs, buffer, idx = 0;
    // get next character
    buffer = str.charAt(idx++); // eslint-disable-line no-cond-assign
    // character found in table? initialize bit storage and add its ascii value;
    ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer,
      // and if not first of each 4 characters,
      // convert the first 8 bits to one ascii character
      bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
  ) {
    // try to find character in table (0-63, not found => -1)
    buffer = chars.indexOf(buffer);
  }
  return output;
}

function getSiteInfo({ referer = '' }) {
  const { href: url, protocol, hostname } = parseUrl(referer, { decodeSearchAsString: true });
  const domain = `${protocol}://${hostname}`;
  let referrer = '';

  try {
    referrer = window.top.document.referrer;
  } catch (ex) { }

  return {
    domain,
    url,
    referrer,
  };
}

function getAdMarkup({ adm, CheckViewability = false, ClickTrackersList = [], ImpTrackersList = [], WinNoticeList = [] }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>advertisement</title>
<script src="//ssp.igaw.io/sdk/js/trk.js"></script>
<style type="text/css">html,body,div,iframe,canvas,video,img,a{margin:0;padding:0;border:0}html{font-size:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}body{line-height:1}a{background-color:transparent}a:focus{outline:thin dotted}a:active,a:hover{outline:0}img{border:0;border-style:none;-ms-interpolation-mode:bicubic;vertical-align:middle}canvas,video{display:inline-block;*display:inline;*zoom:1;max-width:100%}</style>
</head>
<body>
${adm}
${WinNoticeList.map(url => utils.createTrackPixelIframeHtml(url))}
<script>
IGAWorks.Tracker.Viewability([${ImpTrackersList.map(url => `'${url}'`).join(',')}], ${!CheckViewability});
</script>
</body>
</html>`;
}

/**
 * @see ua-parser-js {@link https://github.com/faisalman/ua-parser-js}
 */
class Ua {
  constructor(ua) {
    this.ua = ua;
    [].forEach.call(['device', 'os', 'browser'], prop => {
      this[prop] = () => {
          const obj = Ua.mapper.rgx(ua, Ua.rgxmap[prop]);

          if (prop === 'device' && utils.isEmpty(obj)) {
            obj.type = 'desktop';
          }
          return obj;
      };
    });
  }
  toString() {
    return this.ua;
  }
}
Ua.utils = {
  has(a, b) {
    return utils.isStr(a)
      ? b.toLowerCase().indexOf(a.toLowerCase()) !== -1
      : false;
  },
  lowerize(a) {
    return a.toLowerCase();
  }
};
Ua.mapper = {
  rgx(ua, arrays) {
    let j;
    let k;
    let matches;
    let i = 0;
    let obj = {};
    while (i < arrays.length && !matches) {
      let regex = arrays[i];
      let props = arrays[i + 1];
      j = k = 0;
      while (j < regex.length && !matches) {
        matches = regex[j++].exec(ua);
        if (matches) {
          for (let match, prop, p = 0; p < props.length; p++) {
            match = matches[++k];
            prop = props[p];
            if (utils.isArray(prop)) {
              const [key, rgx, str, fn] = prop;
              if (prop.length === 2) {
                obj[key] = utils.isFn(rgx)
                  ? rgx.call(obj, match)
                  : rgx;
              } else if (prop.length === 3) {
                obj[key] = !match
                  ? void 0
                  : (utils.isFn(rgx) && !(rgx.exec && rgx.test)
                    ? rgx.call(obj, match, str)
                    : match.replace(rgx, str)
                  );
              } else if (prop.length === 4) {
                obj[key] = match
                  ? fn.call(obj, match.replace(rgx, str))
                  : void 0;
              }
            } else {
              obj[prop] = match || void 0;
            }
          }
        }
      }
      i += 2;
    }
    return obj;
  },
  str(str, map) {
    for (const i in map) {
      if (utils.isArray(map[i])) {
        for (let j = 0; j < map[i].length; j++) {
          if (Ua.utils.has(map[i][j], str)) {
            return i === '?' ? void 0 : i;
          }
        }
      } else if (Ua.utils.has(map[i], str)) {
        return i === '?' ? void 0 : i;
      }
    }
    return str;
  },
};
Ua.maps = {
  os: {
    windows: {
      version: {
        'ME': '4.90',
        'NT 3.11': 'NT3.51',
        'NT 4.0': 'NT4.0',
        '2000': 'NT 5.0',
        'XP': ['NT 5.1', 'NT 5.2'],
        'Vista': 'NT 6.0',
        '7': 'NT 6.1',
        '8': 'NT 6.2',
        '8.1': 'NT 6.3',
        '10': ['NT 6.4', 'NT 10.0'],
        'RT': 'ARM',
      },
    }
  },
};
Ua.C = {
  MODEL: 'model',
  NAME: 'name',
  VENDOR: 'vendor',
  VERSION: 'version',
  CONSOLE: ['type', 'console'],
  MOBILE: ['type', 'mobile'],
  TABLET: ['type', 'tablet'],
  SMARTTV: ['type', 'smarttv'],
};
Ua.rgxmap = {
  device: [
    [/\((ipad|playbook);[\w\s\),;-]+(rim|apple)/i], [Ua.C.MODEL, Ua.C.VENDOR, Ua.C.TABLET],
    [/applecoremedia\/[\w\.]+ \((ipad)/], [Ua.C.MODEL, [Ua.C.VENDOR, 'Apple'], Ua.C.TABLET],
    [/(apple\s{0,1}tv)/i], [[Ua.C.MODEL, 'Apple TV'], [Ua.C.VENDOR, 'Apple']],
    [/(archos)\s(gamepad2?)/i, /(hp).+(touchpad)/i, /(hp).+(tablet)/i, /(kindle)\/([\w\.]+)/i, /\s(nook)[\w\s]+build\/(\w+)/i, /(dell)\s(strea[kpr\s\d]*[\dko])/i], [Ua.C.VENDOR, Ua.C.MODEL, Ua.C.TABLET],
    [/(kf[A-z]+)\sbuild\/.+silk\//i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Amazon'], Ua.C.TABLET],
    [/android.+aft([bms])\sbuild/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Amazon'], Ua.C.SMARTTV],
    [/\((ip[honed|\s\w*]+);.+(apple)/i], [Ua.C.MODEL, Ua.C.VENDOR, Ua.C.MOBILE],
    [/\((ip[honed|\s\w*]+);/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Apple'], Ua.C.MOBILE],
    [/(blackberry)[\s-]?(\w+)/i, /(blackberry|benq|palm(?=\-)|sonyericsson|acer|asus|dell|meizu|motorola|polytron)[\s_-]?([\w-]*)/i, /(hp)\s([\w\s]+\w)/i, /(asus)-?(\w+)/i], [Ua.C.VENDOR, Ua.C.MODEL, Ua.C.MOBILE],
    [/\(bb10;\s(\w+)/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'BlackBerry'], Ua.C.MOBILE],
    [/android.+(transfo[prime\s]{4,10}\s\w+|eeepc|slider\s\w+|nexus 7|padfone|p00c)/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Asus'], Ua.C.TABLET],
    [/(sony)\s(tablet\s[ps])\sbuild\//i, /(sony)?(?:sgp.+)\sbuild\//i], [[Ua.C.VENDOR, 'Sony'], [Ua.C.MODEL, 'Xperia'], Ua.C.TABLET],
    [/android.+\s([c-g]\d{4}|so[-l]\w+)(?=\sbuild\/|\).+chrome\/(?![1-6]{0,1}\d\.))/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Sony'], Ua.C.MOBILE],
    [/(nintendo)\s([wids3u]+)/i], [Ua.C.VENDOR, Ua.C.MODEL, Ua.C.CONSOLE],
    [/(playstation\s[34portablevi]+)/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Sony'], Ua.C.CONSOLE],
    [/(htc)[;_\s-]+([\w\s]+(?=\)|\sbuild)|\w+)/i, /(zte)-(\w*)/i, /(alcatel|geeksphone|nexian|panasonic|(?=;\s)sony)[_\s-]?([\w-]*)/i], [Ua.C.VENDOR, [Ua.C.MODEL, /_/g, ' '], Ua.C.MOBILE],
    [/(nexus\s9)/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'HTC'], Ua.C.TABLET],
    [/d\/huawei([\w\s-]+)[;\)]/i, /(nexus\s6p)/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Huawei'], Ua.C.MOBILE],
    [/(microsoft);\s(lumia[\s\w]+)/i], [Ua.C.VENDOR, Ua.C.MODEL, Ua.C.MOBILE],
    [/[\s\(;](xbox(?:\sone)?)[\s\);]/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Microsoft'], Ua.C.CONSOLE],
    [/(kin\.[onetw]{3})/i], [[Ua.C.MODEL, /\./g, ' '], [Ua.C.VENDOR, 'Microsoft'], Ua.C.MOBILE],
    [/\s(milestone|droid(?:[2-4x]|\s(?:bionic|x2|pro|razr))?:?(\s4g)?)[\w\s]+build\//i, /mot[\s-]?(\w*)/i, /(XT\d{3,4}) build\//i, /(nexus\s6)/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Motorola'], Ua.C.MOBILE],
    [/android.+\s(mz60\d|xoom[\s2]{0,2})\sbuild\//i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Motorola'], Ua.C.TABLET],
    [/android.+((sch-i[89]0\d|shw-m380s|gt-p\d{4}|gt-n\d+|sgh-t8[56]9|nexus 10))/i, /((SM-T\w+))/i], [[Ua.C.VENDOR, 'Samsung'], Ua.C.MODEL, Ua.C.TABLET],
    [/smart-tv.+(samsung)/i], [Ua.C.VENDOR, Ua.C.SMARTTV, Ua.C.MODEL],
    [/((s[cgp]h-\w+|gt-\w+|galaxy\snexus|sm-\w[\w\d]+))/i, /(sam[sung]*)[\s-]*(\w+-?[\w-]*)/i, /sec-((sgh\w+))/i], [[Ua.C.VENDOR, 'Samsung'], Ua.C.MODEL, Ua.C.MOBILE],
    [/(maemo|nokia).*(n900|lumia\s\d+)/i, /(nokia)[\s_-]?([\w-]*)/i], [[Ua.C.VENDOR, 'Nokia'], Ua.C.MODEL, Ua.C.MOBILE],
    [/android.+([vl]k\-?\d{3})\s+build/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'LG'], Ua.C.TABLET],
    [/android\s3\.[\s\w;-]{10}(lg?)-([06cv9]{3,4})/i], [[Ua.C.VENDOR, 'LG'], Ua.C.MODEL, Ua.C.TABLET],
    [/(lg) netcast\.tv/i], [Ua.C.VENDOR, Ua.C.MODEL, Ua.C.SMARTTV],
    [/(nexus\s[45])/i, /lg[e;\s\/-]+(\w*)/i, /android.+lg(\-?[\d\w]+)\s+build/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'LG'], Ua.C.MOBILE],
    [/(lenovo)\s?(s(?:5000|6000)(?:[\w-]+)|tab(?:[\s\w]+))/i], [Ua.C.VENDOR, Ua.C.MODEL, Ua.C.TABLET],
    [/android.+(ideatab[a-z0-9\-\s]+)/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Lenovo'], Ua.C.TABLET],
    [/(lenovo)[_\s-]?([\w-]+)/i], [Ua.C.VENDOR, Ua.C.MODEL, Ua.C.MOBILE],
    [/android.+;\s(oppo)\s?([\w\s]+)\sbuild/i], [Ua.C.VENDOR, Ua.C.MODEL, Ua.C.MOBILE],
    [/crkey/i], [[Ua.C.MODEL, 'Chromecast'], [Ua.C.VENDOR, 'Google']],
    [/android.+;\s(pixel c)[\s)]/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Google'], Ua.C.TABLET],
    [/android.+;\s(pixel( [23])?( xl)?)[\s)]/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Google'], Ua.C.MOBILE],
    [/android.+;\s(\w+)\s+build\/hm\1/i, /android.+(hm[\s\-_]*note?[\s_]*(?:\d\w)?)\s+build/i, /android.+(mi[\s\-_]*(?:a\d|one|one[\s_]plus|note lte)?[\s_]*(?:\d?\w?)[\s_]*(?:plus)?)\s+build/i, /android.+(redmi[\s\-_]*(?:note)?(?:[\s_]*[\w\s]+))\s+build/i], [[Ua.C.MODEL, /_/g, ' '], [Ua.C.VENDOR, 'Xiaomi'], Ua.C.MOBILE],
    [/android.+(mi[\s\-_]*(?:pad)(?:[\s_]*[\w\s]+))\s+build/i], [[Ua.C.MODEL, /_/g, ' '], [Ua.C.VENDOR, 'Xiaomi'], Ua.C.TABLET],
    [/android.+;\s(m[1-5]\snote)\sbuild/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Meizu'], Ua.C.MOBILE],
    [/(mz)-([\w-]{2,})/i], [[Ua.C.VENDOR, 'Meizu'], Ua.C.MODEL, Ua.C.MOBILE],
    [/android.+;\s(k88)\sbuild/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'ZTE'], Ua.C.TABLET],
    [/android.+(KS(.+))\s+build/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Amazon'], Ua.C.TABLET],
    [/\s(tablet|tab)[;\/]/i, /\s(mobile)(?:[;\/]|\ssafari)/i], [['type', Ua.utils.lowerize], Ua.C.VENDOR, Ua.C.MODEL],
    [/[\s\/\(](smart-?tv)[;\)]/i], [Ua.C.SMARTTV],
    [/(android[\w\.\s\-]{0,9});.+build/i], [Ua.C.MODEL, [Ua.C.VENDOR, 'Generic']],
  ],
  os: [
    [/microsoft\s(windows)\s(vista|xp)/i], [Ua.C.NAME, Ua.C.VERSION],
    [/(windows)\snt\s6\.2;\s(arm)/i, /(windows\sphone(?:\sos)*)[\s\/]?([\d\.\s\w]*)/i, /(windows\smobile|windows)[\s\/]?([ntce\d\.\s]+\w)/i], [Ua.C.NAME, [Ua.C.VERSION, Ua.mapper.str, Ua.maps.os.windows.version]],
    [/(win(?=3|9|n)|win\s9x\s)([nt\d\.]+)/i], [[Ua.C.NAME, 'Windows'], [Ua.C.VERSION, Ua.mapper.str, Ua.maps.os.windows.version]],
    [/\((bb)(10);/i], [[Ua.C.NAME, 'BlackBerry'], Ua.C.VERSION],
    [/(blackberry)\w*\/?([\w\.]*)/i, /(tizen)[\/\s]([\w\.]+)/i, /(android|webos|bada)[\/\s-]?([\w\.]*)/i], [Ua.C.NAME, Ua.C.VERSION],
    [/(symbian\s?os|symbos|s60(?=;))[\/\s-]?([\w\.]*)/i], [[Ua.C.NAME, 'Symbian'], Ua.C.VERSION],
    [/mozilla.+\(mobile;.+gecko.+firefox/i], [[Ua.C.NAME, 'Firefox OS'], Ua.C.VERSION],
    [/(nintendo|playstation)\s([wids34portablevu]+)/i, /([kxln]?ubuntu|debian|suse|opensuse|(?=\s)arch|fedora|centos|redhat|zenwalk)[\/\s-]?(?!chrom)([\w\.-]*)/i, /(linux)\s?([\w\.]*)/i, /(gnu)\s?([\w\.]*)/i], [Ua.C.NAME, Ua.C.VERSION],
    [/(cros)\s[\w]+\s([\w\.]+\w)/i], [[Ua.C.NAME, 'Chromium OS'], Ua.C.VERSION],
    [/(sunos)\s?([\w\.\d]*)/i], [[Ua.C.NAME, 'Solaris'], Ua.C.VERSION],
    [/\s([frentopc-]{0,4}bsd|dragonfly)\s?([\w\.]*)/i, /(haiku)\s(\w+)/i], [Ua.C.NAME, Ua.C.VERSION],
    [/cfnetwork\/.+darwin/i, /ip[honead]{2,4}(?:.*os\s([\w]+)\slike\smac|;\sopera)/i], [[Ua.C.VERSION, /_/g, '.'], [Ua.C.NAME, 'iOS']],
    [/(mac\sos\sx)\s?([\w\s\.]*)/i, /(macintosh|mac(?=_powerpc)\s)/i], [[Ua.C.NAME, 'MaC OS'], [Ua.C.VERSION, /_/g, '.']],
    [/((?:open)?solaris)[\/\s-]?([\w\.]*)/i, /(plan\s9|minix|beos|os\/2|amigaos|morphos|risc\sos|openvms|fuchsia)/i, /(unix)\s?([\w\.]*)/i], [Ua.C.NAME, Ua.C.VERSION],
  ],
  browser: [
    [/(opera\smini)\/([\w\.-]+)/i, /(opera\s[mobiletab]+).+version\/([\w\.-]+)/i, /(opera).+version\/([\w\.]+)/i, /(opera)[\/\s]+([\w\.]+)/i], [Ua.C.NAME, Ua.C.VERSION],
    [/(opios)[\/\s]+([\w\.]+)/i], [[Ua.C.NAME, 'Opera Mini'], Ua.C.VERSION],
    [/\s(opr)\/([\w\.]+)/i], [[Ua.C.NAME, 'Opera'], Ua.C.VERSION],
    [/(kindle)\/([\w\.]+)/i, /(iemobile|baidu)(?:browser)?[\/\s]?([\w\.]*)/i, /(?:ms|\()(ie)\s([\w\.]+)/i, /(chromium|silk|phantomjs)\/([\w\.-]+)/i], [Ua.C.NAME, Ua.C.VERSION],
    [/(trident).+rv[:\s]([\w\.]+).+like\sgecko/i], [[Ua.C.NAME, 'IE'], Ua.C.VERSION],
    [/(edge|edgios|edga|edg)\/((\d+)?[\w\.]+)/i], [[Ua.C.NAME, 'Edge'], Ua.C.VERSION],
    [/(yabrowser)\/([\w\.]+)/i], [[Ua.C.NAME, 'Yandex'], Ua.C.VERSION],
    [/(puffin)\/([\w\.]+)/i], [[Ua.C.NAME, 'Puffin'], Ua.C.VERSION],
    [/(focus)\/([\w\.]+)/i], [[Ua.C.NAME, 'Firefox Focus'], Ua.C.VERSION],
    [/(opt)\/([\w\.]+)/i], [[Ua.C.NAME, 'Opera Touch'], Ua.C.VERSION],
    [/((?:[\s\/])uc?\s?browser|(?:juc.+)ucweb)[\/\s]?([\w\.]+)/i], [[Ua.C.NAME, 'UCBrowser'], Ua.C.VERSION],
    [/(windowswechat qbcore)\/([\w\.]+)/i, /(micromessenger)\/([\w\.]+)/i], [[Ua.C.NAME, 'WeChat'], Ua.C.VERSION],
    [/(qqbrowserlite)\/([\w\.]+)/i, /(QQ)\/([\d\.]+)/i, /m?(qqbrowser)[\/\s]?([\w\.]+)/i, /(BIDUBrowser)[\/\s]?([\w\.]+)/i], [Ua.C.NAME, Ua.C.VERSION],
    [/(MetaSr)[\/\s]?([\w\.]+)/i, /(LBBROWSER)/i], [Ua.C.NAME],
    [/xiaomi\/miuibrowser\/([\w\.]+)/i], [Ua.C.VERSION, [Ua.C.NAME, 'MIUI Browser']],
    [/;fbav\/([\w\.]+);/i], [Ua.C.VERSION, [Ua.C.NAME, 'Facebook']],
    [/safari\s(line)\/([\w\.]+)/i, /android.+(line)\/([\w\.]+)\/iab/i], [Ua.C.NAME, Ua.C.VERSION],
    [/headlesschrome(?:\/([\w\.]+)|\s)/i], [Ua.C.VERSION, [Ua.C.NAME, 'Chrome Headless']],
    [/\swv\).+(chrome)\/([\w\.]+)/i], [[Ua.C.NAME, /(.+)/, '$1 WebView'], Ua.C.VERSION],
    [/((?:oculus|samsung)browser)\/([\w\.]+)/i], [[Ua.C.NAME, /(.+(?:g|us))(.+)/, '$1 $2'], Ua.C.VERSION],
    [/android.+version\/([\w\.]+)\s+(?:mobile\s?safari|safari)*/i], [Ua.C.VERSION, [Ua.C.NAME, 'Android Browser']],
    [/(whale|chrome|[tizenoka]{5}\s?browser)\/v?([\w\.]+)/i], [Ua.C.NAME, Ua.C.VERSION],
    [/(dolfin)\/([\w\.]+)/i], [[Ua.C.NAME, 'Dolphin'], Ua.C.VERSION],
    [/((?:android.+)crmo|crios)\/([\w\.]+)/i], [[Ua.C.NAME, 'Chrome'], Ua.C.VERSION],
    [/(coast)\/([\w\.]+)/i], [[Ua.C.NAME, 'Opera Coast'], Ua.C.VERSION],
    [/fxios\/([\w\.-]+)/i], [Ua.C.VERSION, [Ua.C.NAME, 'Firefox']],
    [/version\/([\w\.]+).+?mobile\/\w+\s(safari)/i], [Ua.C.VERSION, [Ua.C.NAME, 'Mobile Safari']],
    [/version\/([\w\.]+).+?(mobile\s?safari|safari)/i], [Ua.C.VERSION, Ua.C.NAME],
    [/webkit.+?(gsa)\/([\w\.]+).+?(mobile\s?safari|safari)(\/[\w\.]+)/i], [[Ua.C.NAME, 'GSA'], Ua.C.VERSION],
    [/(webkit|khtml)\/([\w\.]+)/i], [Ua.C.NAME, Ua.C.VERSION],
    [/(firefox)\/([\w\.-]+)$/i, /(mozilla)\/([\w\.]+).+rv\:.+gecko\/\d+/i], [Ua.C.NAME, Ua.C.VERSION],
  ],
};
