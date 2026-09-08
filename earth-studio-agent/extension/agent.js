"use strict";
var EarthStudioAgent = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/extension/run-in-page.ts
  var run_in_page_exports = {};
  __export(run_in_page_exports, {
    AgentError: () => AgentError,
    runCommandInPage: () => runCommandInPage
  });

  // src/errors.ts
  var AgentError = class extends Error {
    code;
    /** 1-based step index, when the failure belongs to a specific step. */
    stepIndex;
    /** Extra context shown under the message in CLI output. */
    detail;
    /** What the user can do about it. */
    hint;
    constructor(code, message, options = {}) {
      super(message, { cause: options.cause });
      this.name = "AgentError";
      this.code = code;
      this.stepIndex = options.stepIndex;
      this.detail = options.detail;
      this.hint = options.hint;
    }
    /** Multi-line rendering used by the CLI and the run log. */
    format() {
      const where = this.stepIndex === void 0 ? "" : ` (step ${this.stepIndex})`;
      const lines = [`[${this.code}]${where} ${this.message}`];
      if (this.detail) lines.push(`  detail: ${this.detail}`);
      if (this.hint) lines.push(`  hint:   ${this.hint}`);
      return lines.join("\n");
    }
  };

  // src/smart.ts
  var DEFAULT_AUTO_DURATION = {
    base: 2.5,
    perDistance: 1.2,
    perAltitude: 0.9,
    min: 2,
    max: 10
  };
  function groundDistanceKm(from, to) {
    const earthRadiusKm = 6371;
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const deltaLat = toRadians(to.latitude - from.latitude);
    const deltaLon = toRadians(to.longitude - from.longitude);
    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLon / 2) ** 2;
    return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function smartDuration(from, to, settings = DEFAULT_AUTO_DURATION) {
    const distanceKm = groundDistanceKm(from, to);
    const high = Math.max(from.altitude, to.altitude);
    const low = Math.max(1, Math.min(from.altitude, to.altitude));
    const altitudeRatio = high / low;
    const seconds = settings.base + settings.perDistance * Math.log10(1 + distanceKm) + settings.perAltitude * Math.log10(Math.max(1, altitudeRatio));
    return round(clamp(seconds, settings.min, settings.max), 2);
  }
  var TILT_BY_ALTITUDE = [
    [1e7, 0],
    [8e5, 8],
    [15e4, 25],
    [15e3, 40],
    [1500, 60],
    [150, 75]
  ];
  function smartTilt(altitudeMetres) {
    const altitude = Math.max(1, altitudeMetres);
    const first = TILT_BY_ALTITUDE[0];
    const last = TILT_BY_ALTITUDE.at(-1);
    if (first === void 0 || last === void 0) return 0;
    if (altitude >= first[0]) return first[1];
    if (altitude <= last[0]) return last[1];
    for (let index = 0; index < TILT_BY_ALTITUDE.length - 1; index += 1) {
      const upper = TILT_BY_ALTITUDE[index];
      const lower = TILT_BY_ALTITUDE[index + 1];
      if (upper === void 0 || lower === void 0) continue;
      if (altitude <= upper[0] && altitude >= lower[0]) {
        const span = Math.log10(upper[0]) - Math.log10(lower[0]);
        const position = (Math.log10(upper[0]) - Math.log10(altitude)) / span;
        return round(upper[1] + position * (lower[1] - upper[1]), 1);
      }
    }
    return 0;
  }
  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }
  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  // src/config.ts
  var DEFAULT_ALTITUDE_TABLE = {
    space: 1e7,
    country: 8e5,
    region: 15e4,
    city: 15e3,
    close: 1500,
    street: 150
  };
  var DEFAULT_DESCRIPTOR_BY_PLACE_KIND = {
    country: "country",
    region: "region",
    city: "city",
    landmark: "close",
    unknown: "city"
  };
  var DEFAULT_CONFIG = {
    frameRate: 30,
    width: 1920,
    height: 1080,
    defaultTransitionSeconds: 4,
    defaultHoldSeconds: 2,
    startAltitude: DEFAULT_ALTITUDE_TABLE.space,
    automaticTiming: true,
    automaticTilt: true,
    autoDuration: { ...DEFAULT_AUTO_DURATION },
    writeFieldOfView: false,
    defaultTilt: 0,
    defaultPan: 0,
    defaultRoll: 0,
    defaultFieldOfView: 60,
    altitudeTable: { ...DEFAULT_ALTITUDE_TABLE },
    descriptorByPlaceKind: { ...DEFAULT_DESCRIPTOR_BY_PLACE_KIND },
    ambiguityRatio: 0.6
  };
  function makeConfig(overrides = {}) {
    const automatic = {
      automaticTiming: overrides.defaultTransitionSeconds === void 0,
      automaticTilt: overrides.defaultTilt === void 0,
      writeFieldOfView: overrides.defaultFieldOfView !== void 0
    };
    const config = {
      ...DEFAULT_CONFIG,
      ...automatic,
      ...stripUndefined(overrides),
      altitudeTable: { ...DEFAULT_CONFIG.altitudeTable, ...stripUndefined(overrides.altitudeTable ?? {}) },
      descriptorByPlaceKind: {
        ...DEFAULT_CONFIG.descriptorByPlaceKind,
        ...stripUndefined(overrides.descriptorByPlaceKind ?? {})
      },
      autoDuration: { ...DEFAULT_CONFIG.autoDuration, ...stripUndefined(overrides.autoDuration ?? {}) }
    };
    validateConfig(config);
    return config;
  }
  function validateConfig(config) {
    if (!Number.isFinite(config.frameRate) || config.frameRate <= 0) {
      throw new AgentError("INVALID_CONFIG", `frameRate must be a positive number, got ${config.frameRate}`);
    }
    if (config.frameRate > 240) {
      throw new AgentError("INVALID_CONFIG", `frameRate ${config.frameRate} is above the supported maximum of 240`);
    }
    for (const key of ["defaultTransitionSeconds", "defaultHoldSeconds"]) {
      const value = config[key];
      if (!Number.isFinite(value) || value <= 0) {
        throw new AgentError("INVALID_CONFIG", `${key} must be a positive number, got ${value}`);
      }
    }
    for (const [descriptor, altitude] of Object.entries(config.altitudeTable)) {
      if (!Number.isFinite(altitude) || altitude <= 0) {
        throw new AgentError("INVALID_CONFIG", `altitudeTable.${descriptor} must be a positive number, got ${altitude}`);
      }
    }
    for (const key of ["base", "min", "max"]) {
      const value = config.autoDuration[key];
      if (!Number.isFinite(value) || value <= 0) {
        throw new AgentError("INVALID_CONFIG", `autoDuration.${key} must be a positive number, got ${value}`);
      }
    }
    if (config.autoDuration.min > config.autoDuration.max) {
      throw new AgentError(
        "INVALID_CONFIG",
        `autoDuration.min (${config.autoDuration.min}) is above autoDuration.max (${config.autoDuration.max})`
      );
    }
    if (!Number.isFinite(config.ambiguityRatio) || config.ambiguityRatio <= 0 || config.ambiguityRatio > 1) {
      throw new AgentError("INVALID_CONFIG", `ambiguityRatio must be within (0, 1], got ${config.ambiguityRatio}`);
    }
    for (const key of ["width", "height"]) {
      const value = config[key];
      if (!Number.isInteger(value) || value <= 0) {
        throw new AgentError("INVALID_CONFIG", `${key} must be a positive integer, got ${value}`);
      }
    }
  }
  function stripUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== void 0));
  }

  // src/geocode/gazetteer.ts
  var ROWS = [
    // --- countries -----------------------------------------------------------
    ["Japan", 36.2048, 138.2529, "country", 125e6, "country in East Asia"],
    ["United States", 39.8283, -98.5795, "country", 331e6, "country in North America", ["usa", "us", "u.s.", "u.s.a.", "america", "united states of america", "the states"]],
    ["France", 46.2276, 2.2137, "country", 67e6, "country in Western Europe"],
    ["Italy", 41.8719, 12.5674, "country", 59e6, "country in Southern Europe"],
    ["Germany", 51.1657, 10.4515, "country", 83e6, "country in Central Europe"],
    ["United Kingdom", 55.3781, -3.436, "country", 67e6, "country in Western Europe", ["uk", "u.k.", "britain", "great britain", "england"]],
    ["Spain", 40.4637, -3.7492, "country", 47e6, "country in Southern Europe"],
    ["China", 35.8617, 104.1954, "country", 1412e6, "country in East Asia"],
    ["India", 20.5937, 78.9629, "country", 138e7, "country in South Asia"],
    ["Brazil", -14.235, -51.9253, "country", 213e6, "country in South America"],
    ["Canada", 56.1304, -106.3468, "country", 38e6, "country in North America"],
    ["Australia", -25.2744, 133.7751, "country", 257e5, "country and continent"],
    ["Russia", 61.524, 105.3188, "country", 144e6, "country in Eastern Europe and North Asia"],
    ["Mexico", 23.6345, -102.5528, "country", 128e6, "country in North America"],
    ["Egypt", 26.8206, 30.8025, "country", 102e6, "country in North Africa"],
    ["Kenya", -0.0236, 37.9062, "country", 53e6, "country in East Africa"],
    ["South Africa", -30.5595, 22.9375, "country", 59e6, "country in Southern Africa"],
    ["Nigeria", 9.082, 8.6753, "country", 206e6, "country in West Africa"],
    ["Argentina", -38.4161, -63.6167, "country", 45e6, "country in South America"],
    ["Peru", -9.19, -75.0152, "country", 33e6, "country in South America"],
    ["Chile", -35.6751, -71.543, "country", 19e6, "country in South America"],
    ["Colombia", 4.5709, -74.2973, "country", 5e7, "country in South America"],
    ["Cuba", 21.5218, -77.7812, "country", 11e6, "island country in the Caribbean"],
    ["Norway", 60.472, 8.4689, "country", 54e5, "country in Northern Europe"],
    ["Sweden", 60.1282, 18.6435, "country", 104e5, "country in Northern Europe"],
    ["Finland", 61.9241, 25.7482, "country", 55e5, "country in Northern Europe"],
    ["Denmark", 56.2639, 9.5018, "country", 58e5, "country in Northern Europe"],
    ["Iceland", 64.9631, -19.0208, "country", 37e4, "island country in the North Atlantic"],
    ["Switzerland", 46.8182, 8.2275, "country", 86e5, "country in Central Europe"],
    ["Austria", 47.5162, 14.5501, "country", 89e5, "country in Central Europe"],
    ["Netherlands", 52.1326, 5.2913, "country", 174e5, "country in Western Europe", ["holland"]],
    ["Belgium", 50.5039, 4.4699, "country", 115e5, "country in Western Europe"],
    ["Greece", 39.0742, 21.8243, "country", 107e5, "country in Southern Europe"],
    ["Turkey", 38.9637, 35.2433, "country", 84e6, "country in Anatolia", ["turkiye"]],
    ["Georgia", 42.3154, 43.3569, "country", 11e6, "country in the Caucasus"],
    ["Indonesia", -0.7893, 113.9213, "country", 273e6, "country in Southeast Asia"],
    ["Thailand", 15.87, 100.9925, "country", 7e7, "country in Southeast Asia"],
    ["Vietnam", 14.0583, 108.2772, "country", 97e6, "country in Southeast Asia"],
    ["South Korea", 35.9078, 127.7669, "country", 51e6, "country in East Asia", ["korea"]],
    ["New Zealand", -40.9006, 174.886, "country", 51e5, "island country in Oceania"],
    ["Saudi Arabia", 23.8859, 45.0792, "country", 34e6, "country in the Arabian Peninsula"],
    ["United Arab Emirates", 23.4241, 53.8478, "country", 99e5, "country in the Arabian Peninsula", ["uae"]],
    ["Morocco", 31.7917, -7.0926, "country", 36e6, "country in North Africa"],
    ["Portugal", 39.3999, -8.2245, "country", 103e5, "country in Southern Europe"],
    ["Ireland", 53.1424, -7.6921, "country", 5e6, "island country in Western Europe"],
    ["Poland", 51.9194, 19.1451, "country", 38e6, "country in Central Europe"],
    ["Singapore", 1.3521, 103.8198, "country", 57e5, "city-state in Southeast Asia"],
    ["Nepal", 28.3949, 84.124, "country", 29e6, "country in South Asia"],
    ["Iran", 32.4279, 53.688, "country", 84e6, "country in Western Asia"],
    ["Israel", 31.0461, 34.8516, "country", 92e5, "country in Western Asia"],
    ["Maldives", 3.2028, 73.2207, "country", 54e4, "island country in the Indian Ocean"],
    ["Trinidad and Tobago", 10.6918, -61.2225, "country", 14e5, "island country in the Caribbean"],
    ["Bosnia and Herzegovina", 43.9159, 17.6791, "country", 33e5, "country in the Balkans"],
    // --- regions and states --------------------------------------------------
    ["Georgia", 32.1656, -82.9001, "region", 107e5, "state in the United States", ["georgia usa", "state of georgia"]],
    ["California", 36.7783, -119.4179, "region", 395e5, "state in the United States"],
    ["Texas", 31.9686, -99.9018, "region", 291e5, "state in the United States"],
    ["Florida", 27.6648, -81.5158, "region", 215e5, "state in the United States"],
    ["New York", 43, -75, "region", 198e5, "state in the United States", ["new york state"]],
    ["Alaska", 64.2008, -149.4937, "region", 73e4, "state in the United States"],
    ["Hawaii", 19.8968, -155.5828, "region", 145e4, "state in the United States"],
    ["Washington", 47.7511, -120.7401, "region", 77e5, "state in the United States", ["washington state"]],
    ["Tuscany", 43.7711, 11.2486, "region", 37e5, "region in Italy"],
    ["Bavaria", 48.7904, 11.4979, "region", 131e5, "state in Germany"],
    ["Provence", 43.9352, 6.0679, "region", 51e5, "region in France"],
    ["Scotland", 56.4907, -4.2026, "region", 55e5, "country within the United Kingdom"],
    ["Bali", -8.3405, 115.092, "region", 43e5, "island province of Indonesia"],
    ["Patagonia", -45, -70, "region", 2e6, "region in Argentina and Chile"],
    ["Siberia", 60, 105, "region", 33e6, "region of Russia"],
    // --- cities --------------------------------------------------------------
    ["Tokyo", 35.6762, 139.6503, "city", 37e6, "capital of Japan"],
    ["Kyoto", 35.0116, 135.7681, "city", 15e5, "city in Japan"],
    ["Osaka", 34.6937, 135.5023, "city", 19e6, "city in Japan"],
    ["Sapporo", 43.0618, 141.3545, "city", 195e4, "city in Japan"],
    ["Paris", 48.8566, 2.3522, "city", 11e6, "capital of France"],
    ["Paris, Texas", 33.6609, -95.5555, "city", 25e3, "city in Texas, United States", ["paris texas", "paris"]],
    ["London", 51.5074, -0.1278, "city", 95e5, "capital of the United Kingdom"],
    ["Edinburgh", 55.9533, -3.1883, "city", 53e4, "capital of Scotland"],
    ["Cambridge", 52.2053, 0.1218, "city", 145e3, "city in England"],
    ["Cambridge, Massachusetts", 42.3736, -71.1097, "city", 118e3, "city in Massachusetts, United States", ["cambridge massachusetts", "cambridge ma", "cambridge"]],
    ["New York City", 40.7128, -74.006, "city", 2e7, "city in New York, United States", ["nyc", "new york city", "new york"]],
    ["Los Angeles", 34.0522, -118.2437, "city", 13e6, "city in California, United States", ["la", "l.a."]],
    ["San Francisco", 37.7749, -122.4194, "city", 47e5, "city in California, United States", ["sf"]],
    ["San Jose", 37.3382, -121.8863, "city", 2e6, "city in California, United States", ["san jose california"]],
    ["San Jose, Costa Rica", 9.9281, -84.0907, "city", 16e5, "capital of Costa Rica", ["san jose costa rica", "san jose"]],
    ["Chicago", 41.8781, -87.6298, "city", 95e5, "city in Illinois, United States"],
    ["Seattle", 47.6062, -122.3321, "city", 4e6, "city in Washington, United States"],
    ["Miami", 25.7617, -80.1918, "city", 61e5, "city in Florida, United States"],
    ["Boston", 42.3601, -71.0589, "city", 49e5, "city in Massachusetts, United States"],
    ["Washington, D.C.", 38.9072, -77.0369, "city", 9e6, "capital of the United States", ["washington dc", "dc", "washington d.c.", "washington"]],
    ["Las Vegas", 36.1699, -115.1398, "city", 23e5, "city in Nevada, United States"],
    ["Denver", 39.7392, -104.9903, "city", 296e4, "city in Colorado, United States"],
    ["New Orleans", 29.9511, -90.0715, "city", 127e4, "city in Louisiana, United States"],
    ["St. Louis", 38.627, -90.1994, "city", 28e5, "city in Missouri, United States", ["st louis", "saint louis"]],
    ["Philadelphia", 39.9526, -75.1652, "city", 62e5, "city in Pennsylvania, United States"],
    ["Atlanta", 33.749, -84.388, "city", 61e5, "capital of Georgia, United States"],
    ["Dallas", 32.7767, -96.797, "city", 76e5, "city in Texas, United States"],
    ["Houston", 29.7604, -95.3698, "city", 71e5, "city in Texas, United States"],
    ["Phoenix", 33.4484, -112.074, "city", 49e5, "capital of Arizona, United States"],
    ["San Diego", 32.7157, -117.1611, "city", 33e5, "city in California, United States"],
    ["Portland", 45.5152, -122.6784, "city", 25e5, "city in Oregon, United States"],
    ["Austin", 30.2672, -97.7431, "city", 23e5, "capital of Texas, United States"],
    ["Nashville", 36.1627, -86.7816, "city", 2e6, "capital of Tennessee, United States"],
    ["Springfield, Illinois", 39.7817, -89.6501, "city", 115e3, "capital of Illinois, United States", ["springfield illinois", "springfield"]],
    ["Springfield, Missouri", 37.209, -93.2923, "city", 17e4, "city in Missouri, United States", ["springfield missouri", "springfield"]],
    ["Naples", 40.8518, 14.2681, "city", 31e5, "city in Italy"],
    ["Naples, Florida", 26.142, -81.7948, "city", 38e4, "city in Florida, United States", ["naples florida", "naples"]],
    ["Rome", 41.9028, 12.4964, "city", 43e5, "capital of Italy"],
    ["Venice", 45.4408, 12.3155, "city", 26e4, "city in Italy"],
    ["Florence", 43.7696, 11.2558, "city", 7e5, "city in Italy"],
    ["Milan", 45.4642, 9.19, "city", 32e5, "city in Italy"],
    ["Barcelona", 41.3874, 2.1686, "city", 55e5, "city in Spain"],
    ["Madrid", 40.4168, -3.7038, "city", 67e5, "capital of Spain"],
    ["Berlin", 52.52, 13.405, "city", 37e5, "capital of Germany"],
    ["Munich", 48.1351, 11.582, "city", 15e5, "city in Germany"],
    ["Amsterdam", 52.3676, 4.9041, "city", 115e4, "capital of the Netherlands"],
    ["Prague", 50.0755, 14.4378, "city", 13e5, "capital of Czechia"],
    ["Vienna", 48.2082, 16.3738, "city", 19e5, "capital of Austria"],
    ["Istanbul", 41.0082, 28.9784, "city", 155e5, "city in Turkey"],
    ["Athens", 37.9838, 23.7275, "city", 315e4, "capital of Greece"],
    ["Athens, Georgia", 33.9519, -83.3576, "city", 128e3, "city in Georgia, United States", ["athens georgia", "athens"]],
    ["Cairo", 30.0444, 31.2357, "city", 21e6, "capital of Egypt"],
    ["Dubai", 25.2048, 55.2708, "city", 35e5, "city in the United Arab Emirates"],
    ["Mumbai", 19.076, 72.8777, "city", 2e7, "city in India", ["bombay"]],
    ["Delhi", 28.6139, 77.209, "city", 32e6, "capital territory of India", ["new delhi"]],
    ["Bangkok", 13.7563, 100.5018, "city", 105e5, "capital of Thailand"],
    ["Hong Kong", 22.3193, 114.1694, "city", 75e5, "special administrative region of China"],
    ["Shanghai", 31.2304, 121.4737, "city", 28e6, "city in China"],
    ["Beijing", 39.9042, 116.4074, "city", 215e5, "capital of China"],
    ["Seoul", 37.5665, 126.978, "city", 25e6, "capital of South Korea"],
    ["Sydney", -33.8688, 151.2093, "city", 53e5, "city in Australia"],
    ["Melbourne", -37.8136, 144.9631, "city", 5e6, "city in Australia"],
    ["Auckland", -36.8485, 174.7633, "city", 165e4, "city in New Zealand"],
    ["Rio de Janeiro", -22.9068, -43.1729, "city", 135e5, "city in Brazil", ["rio"]],
    ["Sao Paulo", -23.5505, -46.6333, "city", 22e6, "city in Brazil", ["s\xE3o paulo"]],
    ["Buenos Aires", -34.6037, -58.3816, "city", 15e6, "capital of Argentina"],
    ["Lima", -12.0464, -77.0428, "city", 107e5, "capital of Peru"],
    ["Mexico City", 19.4326, -99.1332, "city", 218e5, "capital of Mexico"],
    ["Toronto", 43.6532, -79.3832, "city", 62e5, "city in Canada"],
    ["Vancouver", 49.2827, -123.1207, "city", 26e5, "city in Canada"],
    ["Montreal", 45.5017, -73.5673, "city", 43e5, "city in Canada"],
    ["Moscow", 55.7558, 37.6173, "city", 125e5, "capital of Russia"],
    ["Reykjavik", 64.1466, -21.9426, "city", 23e4, "capital of Iceland"],
    ["Oslo", 59.9139, 10.7522, "city", 1e6, "capital of Norway"],
    ["Stockholm", 59.3293, 18.0686, "city", 24e5, "capital of Sweden"],
    ["Copenhagen", 55.6761, 12.5683, "city", 135e4, "capital of Denmark"],
    ["Zurich", 47.3769, 8.5417, "city", 14e5, "city in Switzerland"],
    ["Geneva", 46.2044, 6.1432, "city", 6e5, "city in Switzerland"],
    ["Lisbon", 38.7223, -9.1393, "city", 29e5, "capital of Portugal"],
    ["Dublin", 53.3498, -6.2603, "city", 14e5, "capital of Ireland"],
    ["Cape Town", -33.9249, 18.4241, "city", 46e5, "city in South Africa"],
    ["Nairobi", -1.2921, 36.8219, "city", 44e5, "capital of Kenya"],
    ["Marrakesh", 31.6295, -7.9811, "city", 1e6, "city in Morocco", ["marrakech"]],
    ["Jerusalem", 31.7683, 35.2137, "city", 95e4, "city in Israel"],
    ["Kathmandu", 27.7172, 85.324, "city", 15e5, "capital of Nepal"],
    ["Victoria", 48.4284, -123.3656, "city", 4e5, "capital of British Columbia, Canada"],
    // --- landmarks -----------------------------------------------------------
    ["Mount Fuji", 35.3606, 138.7274, "landmark", 3e5, "volcano in Honshu, Japan", ["fuji", "mt fuji", "fujisan"]],
    ["Eiffel Tower", 48.8584, 2.2945, "landmark", 3e5, "tower in Paris, France"],
    ["Louvre", 48.8606, 2.3376, "landmark", 3e5, "museum in Paris, France", ["the louvre", "louvre museum"]],
    ["Statue of Liberty", 40.6892, -74.0445, "landmark", 3e5, "monument in New York Harbor"],
    ["Empire State Building", 40.7484, -73.9857, "landmark", 3e5, "skyscraper in New York City"],
    ["Times Square", 40.758, -73.9855, "landmark", 3e5, "junction in New York City"],
    ["Central Park", 40.7829, -73.9654, "landmark", 3e5, "park in New York City"],
    ["Golden Gate Bridge", 37.8199, -122.4783, "landmark", 3e5, "bridge in San Francisco"],
    ["Hollywood Sign", 34.1341, -118.3215, "landmark", 3e5, "landmark in Los Angeles"],
    ["Grand Canyon", 36.1069, -112.1129, "landmark", 3e5, "canyon in Arizona, United States"],
    ["Monument Valley", 36.998, -110.0985, "landmark", 3e5, "valley on the Arizona-Utah border"],
    ["Antelope Canyon", 36.8619, -111.3743, "landmark", 3e5, "slot canyon in Arizona, United States"],
    ["Death Valley", 36.5054, -117.0794, "landmark", 3e5, "desert valley in California, United States"],
    ["Yosemite", 37.8651, -119.5383, "landmark", 3e5, "national park in California, United States", ["yosemite national park"]],
    ["Yellowstone", 44.428, -110.5885, "landmark", 3e5, "national park in Wyoming, United States", ["yellowstone national park"]],
    ["Mount Rushmore", 43.8791, -103.4591, "landmark", 3e5, "memorial in South Dakota, United States"],
    ["Niagara Falls", 43.0962, -79.0377, "landmark", 3e5, "waterfall on the Canada-United States border"],
    ["Banff", 51.4968, -115.9281, "landmark", 3e5, "national park in Alberta, Canada"],
    ["Great Wall of China", 40.4319, 116.5704, "landmark", 3e5, "fortification in China", ["great wall"]],
    ["Taj Mahal", 27.1751, 78.0421, "landmark", 3e5, "mausoleum in Agra, India"],
    ["Mount Everest", 27.9881, 86.925, "landmark", 3e5, "mountain on the Nepal-China border", ["everest"]],
    ["Angkor Wat", 13.4125, 103.867, "landmark", 3e5, "temple complex in Cambodia"],
    ["Ha Long Bay", 20.9101, 107.1839, "landmark", 3e5, "bay in Vietnam", ["halong bay"]],
    ["Petronas Towers", 3.1578, 101.7117, "landmark", 3e5, "towers in Kuala Lumpur, Malaysia"],
    ["Marina Bay Sands", 1.2834, 103.8607, "landmark", 3e5, "resort in Singapore"],
    ["Fushimi Inari", 34.9671, 135.7727, "landmark", 3e5, "shrine in Kyoto, Japan"],
    ["Shibuya Crossing", 35.6595, 139.7005, "landmark", 3e5, "crossing in Tokyo, Japan", ["shibuya"]],
    ["Colosseum", 41.8902, 12.4922, "landmark", 3e5, "amphitheatre in Rome, Italy"],
    ["Vatican City", 41.9029, 12.4534, "landmark", 3e5, "city-state within Rome", ["the vatican", "vatican"]],
    ["Sagrada Familia", 41.4036, 2.1744, "landmark", 3e5, "basilica in Barcelona, Spain"],
    ["Acropolis", 37.9715, 23.7267, "landmark", 3e5, "citadel in Athens, Greece"],
    ["Santorini", 36.3932, 25.4615, "landmark", 3e5, "island in Greece"],
    ["Hagia Sophia", 41.0086, 28.9802, "landmark", 3e5, "mosque and museum in Istanbul, Turkey"],
    ["Stonehenge", 51.1789, -1.8262, "landmark", 3e5, "monument in Wiltshire, England"],
    ["Big Ben", 51.5007, -0.1246, "landmark", 3e5, "clock tower in London, England"],
    ["Tower Bridge", 51.5055, -0.0754, "landmark", 3e5, "bridge in London, England"],
    ["Buckingham Palace", 51.5014, -0.1419, "landmark", 3e5, "palace in London, England"],
    ["Cliffs of Moher", 52.9715, -9.4309, "landmark", 3e5, "cliffs in County Clare, Ireland"],
    ["Giants Causeway", 55.2408, -6.5116, "landmark", 3e5, "rock formation in Northern Ireland", ["giant's causeway"]],
    ["Mont Saint-Michel", 48.6361, -1.5115, "landmark", 3e5, "island abbey in Normandy, France", ["mont saint michel"]],
    ["Neuschwanstein Castle", 47.5576, 10.7498, "landmark", 3e5, "castle in Bavaria, Germany", ["neuschwanstein"]],
    ["Brandenburg Gate", 52.5163, 13.3777, "landmark", 3e5, "monument in Berlin, Germany"],
    ["Matterhorn", 45.9763, 7.6586, "landmark", 3e5, "mountain on the Swiss-Italian border"],
    ["Cinque Terre", 44.1461, 9.6439, "landmark", 3e5, "coastline in Liguria, Italy"],
    ["Amalfi Coast", 40.634, 14.6027, "landmark", 3e5, "coastline in Campania, Italy"],
    ["Red Square", 55.7539, 37.6208, "landmark", 3e5, "square in Moscow, Russia"],
    ["Blue Lagoon", 63.8804, -22.4495, "landmark", 3e5, "geothermal spa in Iceland"],
    ["Pyramids of Giza", 29.9792, 31.1342, "landmark", 3e5, "pyramids in Giza, Egypt", ["giza", "great pyramid", "the pyramids", "giza pyramids"]],
    ["Petra", 30.3285, 35.4444, "landmark", 3e5, "archaeological site in Jordan"],
    ["Dead Sea", 31.559, 35.4732, "landmark", 3e5, "salt lake bordering Jordan and Israel"],
    ["Sahara Desert", 23.4162, 25.6628, "landmark", 3e5, "desert in North Africa", ["sahara"]],
    ["Mount Kilimanjaro", -3.0674, 37.3556, "landmark", 3e5, "mountain in Tanzania", ["kilimanjaro"]],
    ["Serengeti", -2.3333, 34.8333, "landmark", 3e5, "national park in Tanzania"],
    ["Victoria Falls", -17.9243, 25.8572, "landmark", 3e5, "waterfall on the Zambia-Zimbabwe border"],
    ["Table Mountain", -33.9628, 18.4098, "landmark", 3e5, "mountain in Cape Town, South Africa"],
    ["Machu Picchu", -13.1631, -72.545, "landmark", 3e5, "Inca citadel in Peru"],
    ["Christ the Redeemer", -22.9519, -43.2105, "landmark", 3e5, "statue in Rio de Janeiro, Brazil"],
    ["Iguazu Falls", -25.6953, -54.4367, "landmark", 3e5, "waterfalls on the Argentina-Brazil border", ["iguacu falls"]],
    ["Amazon Rainforest", -3.4653, -62.2159, "landmark", 3e5, "rainforest in South America", ["the amazon", "amazon"]],
    ["Chichen Itza", 20.6843, -88.5678, "landmark", 3e5, "Maya city in Yucatan, Mexico"],
    ["Tulum", 20.2114, -87.4654, "landmark", 3e5, "ruins and town in Quintana Roo, Mexico"],
    ["Uluru", -25.3444, 131.0369, "landmark", 3e5, "rock formation in the Northern Territory, Australia", ["ayers rock"]],
    ["Sydney Opera House", -33.8568, 151.2153, "landmark", 3e5, "performing arts centre in Sydney, Australia"],
    ["Milford Sound", -44.6414, 167.8974, "landmark", 3e5, "fjord in New Zealand"],
    ["Bora Bora", -16.5004, -151.7415, "landmark", 3e5, "island in French Polynesia"],
    ["Burj Khalifa", 25.1972, 55.2744, "landmark", 3e5, "skyscraper in Dubai, United Arab Emirates"]
  ];
  var GAZETTEER = ROWS.map(([name, latitude, longitude, kind, weight, context, aliases]) => ({
    name,
    latitude,
    longitude,
    kind,
    weight,
    context,
    aliases: aliases ?? []
  }));
  function normaliseName(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  var INDEX = /* @__PURE__ */ new Map();
  for (const entry of GAZETTEER) {
    for (const key of [entry.name, ...entry.aliases]) {
      const normalised = normaliseName(key);
      const bucket = INDEX.get(normalised);
      if (bucket) bucket.push(entry);
      else INDEX.set(normalised, [entry]);
    }
  }
  function lookupExact(query) {
    return INDEX.get(normaliseName(query)) ?? [];
  }
  function lookupFuzzy(query) {
    const needle = normaliseName(query);
    if (needle.length < 3) return [];
    const needleTokens = needle.split(" ");
    const hits = [];
    for (const [key, entries] of INDEX) {
      if (key === needle) continue;
      const keyTokens = key.split(" ");
      if (containsSequence(needleTokens, keyTokens) || containsSequence(keyTokens, needleTokens)) {
        hits.push(...entries);
      }
    }
    return [...new Set(hits)];
  }
  function containsSequence(haystack, needle) {
    if (needle.length === 0 || needle.length > haystack.length) return false;
    for (let start = 0; start <= haystack.length - needle.length; start += 1) {
      let matched = true;
      for (let offset = 0; offset < needle.length; offset += 1) {
        if (haystack[start + offset] !== needle[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
    return false;
  }
  function multiWordPlaceNames() {
    const names = /* @__PURE__ */ new Set();
    for (const entry of GAZETTEER) {
      for (const key of [entry.name, ...entry.aliases]) {
        if (key.includes(",") || / and /i.test(key)) names.add(key);
      }
    }
    return [...names].sort((a, b) => b.length - a.length);
  }

  // src/geocode/coordinates.ts
  var SEXAGESIMAL = String.raw`(\d{1,3})\s*[°º]\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*["″”]?\s*)?([NSEWnsew])(?![A-Za-z])`;
  var DECIMAL = String.raw`([+-]?\d{1,3}\.\d+)\s*[°º]?\s*(?:([NSEWnsew])(?![A-Za-z]))?`;
  var COMPONENT = `(?:${SEXAGESIMAL}|${DECIMAL})`;
  var PAIR = `${COMPONENT}\\s*(?:,|;|/|\\s)\\s*${COMPONENT}`;
  var COORDINATE_PATTERN = new RegExp(PAIR, "g");
  function parseCoordinates(text) {
    const trimmed = text.trim().replace(/^[([]|[)\]]$/g, "").trim();
    const whole = new RegExp(`^${PAIR}$`, "i");
    const match = whole.exec(trimmed);
    return match === null ? null : fromMatch(match);
  }
  var UNIT_AFTER = /^\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|m|meter|meters|metre|metres|km|kilometer|kilometers|kilometre|kilometres|ft|foot|feet|mi|mile|miles|deg|degree|degrees|fps|%)\b/i;
  function findCoordinates(text) {
    const found = [];
    COORDINATE_PATTERN.lastIndex = 0;
    for (let match = COORDINATE_PATTERN.exec(text); match !== null; match = COORDINATE_PATTERN.exec(text)) {
      if (fromMatch(match) === null) continue;
      const marked = /[°ºNSEWnsew]/.test(match[0]);
      if (!marked && UNIT_AFTER.test(text.slice(match.index + match[0].length))) continue;
      found.push({ text: match[0].trim(), index: match.index });
    }
    return found;
  }
  function coordinatePlace(query, at) {
    return {
      query,
      name: formatCoordinates(at),
      latitude: at.latitude,
      longitude: at.longitude,
      // A coordinate is a point, not an area, so it gets the close-in altitude a
      // landmark gets rather than a city's.
      kind: "landmark",
      context: "coordinates",
      provider: "coordinates",
      confidence: 1,
      ambiguous: false,
      alternatives: []
    };
  }
  function formatCoordinates(at) {
    return `${at.latitude.toFixed(6)}, ${at.longitude.toFixed(6)}`;
  }
  function fromMatch(match) {
    const first = readComponent(match.slice(1, 7));
    const second = readComponent(match.slice(7, 13));
    if (first === null || second === null) return null;
    let latitude = first;
    let longitude = second;
    const northSouth = /^[nsNS]$/;
    if (first.hemisphere !== null && second.hemisphere !== null) {
      if (northSouth.test(first.hemisphere) === northSouth.test(second.hemisphere)) return null;
      if (!northSouth.test(first.hemisphere)) [latitude, longitude] = [second, first];
    } else if (Math.abs(first.value) > 90 && Math.abs(second.value) <= 90) {
      [latitude, longitude] = [second, first];
    }
    const lat = signed(latitude, /^[sS]$/);
    const lon = signed(longitude, /^[wW]$/);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (lat === 0 && lon === 0) return null;
    return { latitude: round2(lat), longitude: round2(lon) };
  }
  function readComponent(groups) {
    const [degrees, minutes, seconds, hemisphere, decimal, decimalHemisphere] = groups;
    if (degrees !== void 0) {
      const value = Number(degrees) + Number(minutes ?? 0) / 60 + Number(seconds ?? 0) / 3600;
      return Number.isFinite(value) ? { value, hemisphere: hemisphere ?? null } : null;
    }
    if (decimal !== void 0) {
      const value = Number(decimal);
      return Number.isFinite(value) ? { value, hemisphere: decimalHemisphere ?? null } : null;
    }
    return null;
  }
  function signed(component, negative) {
    const magnitude = component.hemisphere === null ? component.value : Math.abs(component.value);
    return component.hemisphere !== null && negative.test(component.hemisphere) ? -magnitude : magnitude;
  }
  function round2(value) {
    return Number(value.toFixed(6));
  }

  // src/keyframe-row.ts
  var NUMBER = String.raw`[+-]?\d+(?:\.\d+)?`;
  var labelled = (labels) => new RegExp(String.raw`\b(?:${labels})\b\s*[:=]?\s*(${NUMBER})`, "i");
  var LATITUDE = labelled("lat|latitude");
  var LONGITUDE = labelled("lon|lng|long|longitude");
  var PAN = labelled("pan|heading|azimuth|yaw|bearing");
  var TILT = labelled("tilt|pitch");
  var ROLL = labelled("roll");
  var FOV = labelled("fov|field of view|focal");
  var ALTITUDE_LABELLED = new RegExp(
    String.raw`\b(?:alt|altitude|height|elevation|elev)\b\s*[:=]?\s*(${NUMBER})\s*(m|metres|meters|km|kilometres|kilometers|ft|feet)?`,
    "i"
  );
  var ALTITUDE_BY_UNIT = new RegExp(String.raw`(${NUMBER})\s*(m|metres|meters|km|kilometres|kilometers|ft|feet)\b`, "i");
  var TIME = new RegExp(String.raw`(?:\bt\s*=\s*|\bat\s+)?(${NUMBER})\s*s(?:ec|econds?)?\b`, "i");
  var METRES_PER_UNIT = {
    m: 1,
    metre: 1,
    metres: 1,
    meter: 1,
    meters: 1,
    km: 1e3,
    kilometre: 1e3,
    kilometres: 1e3,
    kilometer: 1e3,
    kilometers: 1e3,
    ft: 0.3048,
    feet: 0.3048
  };
  function parseKeyframeRow(line) {
    const text = line.replace(/(\d),(?=\d{3}\b)/g, "$1");
    const latitude = read(text, LATITUDE);
    const longitude = read(text, LONGITUDE);
    if (latitude === null || longitude === null) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    const head = text.slice(0, Math.min(indexOf(text, LATITUDE), indexOf(text, LONGITUDE)));
    const time = read(head, TIME);
    return {
      atSeconds: time !== null && time >= 0 ? time : null,
      latitude,
      longitude,
      altitudeMeters: readAltitude(text),
      panDegrees: read(text, PAN),
      tiltDegrees: read(text, TILT),
      rollDegrees: read(text, ROLL),
      fieldOfViewDegrees: read(text, FOV)
    };
  }
  function parseProjectSettings(line) {
    const settings = {};
    const fps = /(\d+(?:\.\d+)?)\s*(?:fps|frames?\s*per\s*second)\b/i.exec(line);
    if (fps !== null) {
      const value = Number(fps[1]);
      if (Number.isFinite(value) && value > 0 && value <= 240) settings.frameRate = value;
    }
    const size = /\b(\d{3,5})\s*[x×*]\s*(\d{3,5})\b/i.exec(line);
    if (size !== null) {
      const width = Number(size[1]);
      const height = Number(size[2]);
      if (Number.isInteger(width) && Number.isInteger(height)) {
        settings.width = width;
        settings.height = height;
      }
    }
    return settings.frameRate === void 0 && settings.width === void 0 ? null : settings;
  }
  function read(text, pattern) {
    const match = pattern.exec(text);
    if (match === null) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }
  function indexOf(text, pattern) {
    const match = pattern.exec(text);
    return match === null ? text.length : match.index;
  }
  function readAltitude(text) {
    const labelledMatch = ALTITUDE_LABELLED.exec(text);
    if (labelledMatch !== null) {
      const value = Number(labelledMatch[1]);
      const unit = (labelledMatch[2] ?? "m").toLowerCase();
      if (Number.isFinite(value)) return value * (METRES_PER_UNIT[unit] ?? 1);
    }
    const byUnit = ALTITUDE_BY_UNIT.exec(text);
    if (byUnit !== null) {
      const value = Number(byUnit[1]);
      const unit = (byUnit[2] ?? "m").toLowerCase();
      if (Number.isFinite(value)) return value * (METRES_PER_UNIT[unit] ?? 1);
    }
    return null;
  }

  // src/parser.ts
  var EXTRA_PROTECTED_PLACES = [
    "antigua and barbuda",
    "saint kitts and nevis",
    "saint vincent and the grenadines",
    "sao tome and principe",
    "turks and caicos islands",
    "wallis and futuna"
  ];
  var PROTECTED_PLACES = [...multiWordPlaceNames(), ...EXTRA_PROTECTED_PLACES].sort(
    (a, b) => b.length - a.length
  );
  var WORD_NUMBERS = {
    half: 0.5,
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    couple: 2,
    few: 3
  };
  var SECONDS_PER_UNIT = {
    s: 1,
    sec: 1,
    secs: 1,
    second: 1,
    seconds: 1,
    min: 60,
    mins: 60,
    minute: 60,
    minutes: 60,
    hr: 3600,
    hrs: 3600,
    hour: 3600,
    hours: 3600
  };
  var METRES_PER_UNIT2 = {
    m: 1,
    meter: 1,
    meters: 1,
    metre: 1,
    metres: 1,
    km: 1e3,
    kilometer: 1e3,
    kilometers: 1e3,
    kilometre: 1e3,
    kilometres: 1e3,
    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,
    mi: 1609.344,
    mile: 1609.344,
    miles: 1609.344
  };
  var DESCRIPTOR_PATTERNS = [
    [/\b(?:outer\s+space|space|global|globe|orbit|orbital|planet|whole\s+earth)\b/, "space"],
    [/\b(?:country|national|nation)(?:[\s-]*level)?\b/, "country"],
    [/\b(?:region|regional|state|province|county)(?:[\s-]*level)?\b/, "region"],
    [/\b(?:city|town|metro|urban)(?:[\s-]*level)?\b/, "city"],
    [/\b(?:street|road|ground|rooftop)(?:[\s-]*level)?\b/, "street"],
    [/\b(?:close[\s-]?up|closeup|really\s+close|very\s+close|super\s+close|tight|landmark|building)(?:[\s-]*level)?\b/, "close"],
    [/\bclose\b/, "close"]
  ];
  var DESCRIPTOR_WORDS = String.raw`(?:outer\s+space|space|global|globe|orbit|orbital|country|national|region|regional|state|province|county|city|town|metro|urban|street|road|ground|rooftop|close[\s-]?up|closeup|close|landmark|building)(?:[\s-]*level)?`;
  var DESCRIPTOR_AFTER_PREPOSITION = new RegExp(String.raw`\b(?:at|to)\s+(?:the\s+)?(${DESCRIPTOR_WORDS})\b`);
  var DESCRIPTOR_AFTER_FROM = new RegExp(
    String.raw`\bfrom\s+(?:the\s+)?(?:high\s+|low\s+|way\s+)?(${DESCRIPTOR_WORDS})\b`
  );
  var ACTION_PATTERNS = [
    [/\b(?:hold|wait|stay|pause|linger|freeze|remain|sit)\b/, "hold"],
    [/\b(?:zoom\s*out|pull\s*(?:out|back|away)|back\s*out|zoom\s*back|widen)\b/, "zoom_out"],
    [/\b(?:zoom\s*(?:in|into|to)?|dive|push\s*in|descend|close\s*in)\b/, "zoom_in"],
    [/\b(?:pan|rotate|swing|turn)\b/, "pan_to"],
    [/\b(?:fly|go|move|travel|jump|cut|head|navigate|transition|sweep|glide)\b/, "fly_to"],
    [/\b(?:start|begin|open|starting|beginning)\b/, "start"]
  ];
  var PLACE_PREPOSITION = /\b(?:to|into|onto|over|at|from|towards?|above|on|near|around)\s+/;
  var PLACE_TAIL_BOUNDARY = /\s+\b(?:from|for|at|in|over|with|until|while|then|during|so)\b/;
  var FILLER_WORDS = /* @__PURE__ */ new Set([
    "then",
    "and",
    "the",
    "a",
    "an",
    "now",
    "next",
    "after",
    "that",
    "this",
    "please",
    "lets",
    "let",
    "us",
    "we",
    "i",
    "camera",
    "view",
    "shot",
    "it",
    "there",
    "here",
    "slowly",
    "quickly",
    "smoothly",
    "gently",
    "straight",
    "down",
    "up",
    "in",
    "out",
    "of",
    "level",
    "for",
    "to",
    "into",
    "at",
    "on",
    "over",
    "from",
    "above",
    "back",
    "again"
  ]);
  var TILT_NUMBER = /\btilt(?:ed)?\s+(?:to\s+)?(-?[0-9]+(?:\.[0-9]+)?)\s*(?:deg|degs|degree|degrees)?\b/;
  var TILT_PHRASES = [
    [/\b(?:top[\s-]?down|straight[\s-]down|overhead|nadir|bird'?s?[\s-]?eye)\b/, 0],
    [/\b(?:angled|oblique|cinematic|dramatic|tilted)\b/, 45],
    [/\b(?:horizon|horizontal|eye[\s-]?level)\b/, 80]
  ];
  var FOV_NUMBER = /\b(?:field[\s-]of[\s-]view|fov|lens)\s+(?:of\s+)?([0-9]+(?:\.[0-9]+)?)\s*(?:deg|degree|degrees)?\b/;
  var FOV_PHRASES = [
    [/\bwide[\s-]?angle\b/, 90],
    [/\b(?:telephoto|narrow[\s-]?angle)\b/, 20]
  ];
  var SPEED_PHRASES = [
    [/\b(?:very\s+slowly|really\s+slowly)\b/, 2.2],
    [/\b(?:slowly|slow|gently|gradually|leisurely)\b/, 1.6],
    [/\b(?:very\s+quickly|really\s+fast)\b/, 0.4],
    [/\b(?:quickly|quick|fast|rapidly|snap|snappy|briskly)\b/, 0.6]
  ];
  var DOT_GUARD = "~d0t~";
  function parseCommand(command) {
    if (typeof command !== "string" || command.trim() === "") {
      throw new AgentError("EMPTY_COMMAND", "The command is empty.", {
        hint: 'Describe the camera move, e.g. "zoom into Japan, hold 3 seconds, then fly to Mount Fuji".'
      });
    }
    const withoutThousands = command.replace(/(\d),(?=\d{3}\b)/g, "$1");
    const { text, restore } = protectAndPlaces(withoutThousands);
    const steps = [];
    const ignored = [];
    const pending = [];
    const notes = [];
    let project;
    let tabled = false;
    for (const sentence of splitSentences(text)) {
      const restoredSentence = restore(sentence).trim();
      const row = parseKeyframeRow(restoredSentence);
      if (row !== null) {
        tabled = true;
        steps.push({
          index: steps.length + 1,
          action: steps.length === 0 ? "start" : "fly_to",
          placeQuery: `${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)}`,
          zoom: null,
          fromZoom: null,
          altitudeMeters: row.altitudeMeters,
          durationSeconds: null,
          atSeconds: row.atSeconds,
          tiltDegrees: row.tiltDegrees,
          panDegrees: row.panDegrees,
          rollDegrees: row.rollDegrees,
          fieldOfViewDegrees: row.fieldOfViewDegrees,
          speedScale: null,
          source: restoredSentence
        });
        continue;
      }
      project = project ?? parseProjectSettings(restoredSentence) ?? void 0;
      let mergeTarget = null;
      for (const rawClause of splitClauses(sentence)) {
        const clause = restore(rawClause).trim();
        if (clause === "") continue;
        const result = parseClause(clause);
        if (result === null) {
          ignored.push(clause);
          continue;
        }
        if (result.kind === "modifier") {
          const target = mergeTarget ?? steps.at(-1) ?? null;
          if (target === null) pending.push(result.fields);
          else mergeInto(target, result.fields);
          continue;
        }
        const parsed = result.step;
        if (mergeTarget !== null && parsed.placeQuery === null && parsed.action !== "hold" && mergeTarget.action !== "hold") {
          mergeInto(mergeTarget, parsed);
          continue;
        }
        const step2 = { ...parsed, index: steps.length + 1 };
        for (const waiting of pending) backfill(step2, waiting);
        pending.length = 0;
        steps.push(step2);
        mergeTarget = step2;
      }
    }
    if (tabled) {
      for (const step2 of steps) {
        if (step2.atSeconds === null && step2.panDegrees === null) notes.push(step2.source);
      }
      const rows = steps.filter((step2) => step2.atSeconds !== null || step2.panDegrees !== null);
      steps.length = 0;
      steps.push(...rows);
      steps.forEach((step2, i) => {
        step2.index = i + 1;
        step2.action = i === 0 ? "start" : "fly_to";
      });
    }
    if (steps.length === 0) {
      throw new AgentError("NO_STEPS_PARSED", "No camera steps could be read from the command.", {
        detail: ignored.length > 0 ? `Unrecognised text: ${ignored.join(" | ")}` : void 0,
        hint: 'Name at least one place and one action, e.g. "fly to Rome and zoom in close".'
      });
    }
    return { steps, ignored, project, notes };
  }
  function mergeInto(target, extra) {
    if (extra.zoom !== null) target.zoom = extra.zoom;
    if (extra.fromZoom !== null) target.fromZoom = extra.fromZoom;
    if (extra.altitudeMeters !== null) target.altitudeMeters = extra.altitudeMeters;
    if (extra.durationSeconds !== null) target.durationSeconds = extra.durationSeconds;
    if (extra.tiltDegrees !== null) target.tiltDegrees = extra.tiltDegrees;
    if (extra.fieldOfViewDegrees !== null) target.fieldOfViewDegrees = extra.fieldOfViewDegrees;
    if (extra.speedScale !== null) target.speedScale = extra.speedScale;
    if (target.action === "start") {
    } else if (extra.action === "zoom_in" || extra.action === "zoom_out") {
      if (target.action !== "fly_to" && target.action !== "pan_to") {
        target.action = extra.action;
      }
    }
    target.source = `${target.source} + ${extra.source}`;
  }
  function backfill(target, extra) {
    if (target.tiltDegrees === null) target.tiltDegrees = extra.tiltDegrees;
    if (target.fieldOfViewDegrees === null) target.fieldOfViewDegrees = extra.fieldOfViewDegrees;
    if (target.speedScale === null) target.speedScale = extra.speedScale;
    target.source = `${extra.source} + ${target.source}`;
  }
  function protectAndPlaces(command) {
    const found = [];
    let text = command;
    for (const coordinate of findCoordinates(text)) {
      found.push(coordinate.text);
      text = text.replace(coordinate.text, `~p${found.length - 1}~`);
    }
    for (const place of PROTECTED_PLACES) {
      const pattern = new RegExp(escapeForRegExp(place).replace(/(?:\\\s)+/g, "\\s+"), "gi");
      text = text.replace(pattern, (match) => {
        found.push(match);
        return `~p${found.length - 1}~`;
      });
    }
    const restore = (value) => value.replace(/~p(\d+)~/g, (_, index) => found[Number(index)] ?? "");
    return { text, restore };
  }
  function escapeForRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s/g, "\\s");
  }
  var ABBREVIATIONS = /\b(mt|st|ste|ft|dr|mr|mrs|ms|jr|sr|ave|blvd|rd|no|vs)\.(?=\s|$)/gi;
  function splitSentences(text) {
    const guarded = text.replace(ABBREVIATIONS, (_, word) => `${word}${DOT_GUARD}`).replace(/\b([A-Za-z])\.(?=[A-Za-z])/g, (_, letter) => `${letter}${DOT_GUARD}`).replace(/(?<=\d)\.(?=\d)/g, DOT_GUARD);
    return guarded.split(/[.;!?\n\r\t]+/).map((part) => part.split(DOT_GUARD).join(".").trim()).filter((part) => part !== "");
  }
  function splitClauses(sentence) {
    return sentence.split(/,|\s+\band\s+then\b\s+|\s+\band\b\s+|\s+\bthen\b\s+|\s+\bafter\s+that\b\s+/i).map((part) => part.trim()).filter((part) => part !== "");
  }
  function parseClause(clause) {
    const source = clause;
    let working = ` ${clause.toLowerCase().replace(/\s+/g, " ")} `;
    const coordinates = findCoordinates(clause)[0]?.text ?? null;
    if (coordinates !== null) working = working.replace(coordinates.toLowerCase(), " ");
    let fromZoom = null;
    const origin = working.match(DESCRIPTOR_AFTER_FROM);
    if (origin) {
      fromZoom = readDescriptorExact(origin[1] ?? "");
      if (fromZoom !== null) working = working.replace(DESCRIPTOR_AFTER_FROM, " ");
    }
    const tilt = extractTilt(working);
    working = tilt.rest;
    const fieldOfView = extractFieldOfView(working);
    working = fieldOfView.rest;
    const speed = extractSpeed(working);
    working = speed.rest;
    const altitude = extractAltitude(working);
    working = altitude.rest;
    const duration = extractDuration(working);
    working = duration.rest;
    let zoom = null;
    const prepositional = working.match(DESCRIPTOR_AFTER_PREPOSITION);
    if (prepositional) {
      zoom = readDescriptorExact(prepositional[1] ?? "");
      working = working.replace(DESCRIPTOR_AFTER_PREPOSITION, " ");
    }
    const verbAction = readVerb(working);
    const place = coordinates === null ? extractPlace(working) : { value: coordinates, rest: working };
    working = place.rest;
    let placeQuery = place.value;
    if (placeQuery !== null) {
      const asDescriptor = readDescriptorExact(placeQuery);
      if (asDescriptor !== null) {
        zoom = zoom ?? asDescriptor;
        placeQuery = null;
      }
    }
    if (zoom === null) zoom = readDescriptor(working);
    const action = verbAction ?? readAction(working, placeQuery !== null, zoom ?? fromZoom);
    if (action === "start" && zoom === null) {
      zoom = fromZoom;
      fromZoom = null;
    }
    const fields = {
      placeQuery,
      zoom,
      fromZoom,
      altitudeMeters: altitude.value,
      durationSeconds: duration.value,
      atSeconds: null,
      tiltDegrees: tilt.value,
      panDegrees: null,
      rollDegrees: null,
      fieldOfViewDegrees: fieldOfView.value,
      speedScale: speed.value,
      source
    };
    if (action !== null) return { kind: "step", step: { ...fields, action } };
    const setsCamera = tilt.value !== null || fieldOfView.value !== null || speed.value !== null;
    if (setsCamera && placeQuery === null) return { kind: "modifier", fields };
    return null;
  }
  function extractTilt(text) {
    const numbered = text.match(TILT_NUMBER);
    if (numbered) {
      const value = Number.parseFloat(numbered[1] ?? "");
      if (Number.isFinite(value)) return { value, rest: text.replace(numbered[0], " ") };
    }
    for (const [pattern, degrees] of TILT_PHRASES) {
      const match = text.match(pattern);
      if (match) return { value: degrees, rest: text.replace(match[0], " ") };
    }
    return { value: null, rest: text };
  }
  function extractFieldOfView(text) {
    const numbered = text.match(FOV_NUMBER);
    if (numbered) {
      const value = Number.parseFloat(numbered[1] ?? "");
      if (Number.isFinite(value) && value > 0) return { value, rest: text.replace(numbered[0], " ") };
    }
    for (const [pattern, degrees] of FOV_PHRASES) {
      const match = text.match(pattern);
      if (match) return { value: degrees, rest: text.replace(match[0], " ") };
    }
    return { value: null, rest: text };
  }
  function extractSpeed(text) {
    for (const [pattern, scale] of SPEED_PHRASES) {
      const match = text.match(pattern);
      if (match) return { value: scale, rest: text.replace(match[0], " ") };
    }
    return { value: null, rest: text };
  }
  var ALTITUDE_UNITS = Object.keys(METRES_PER_UNIT2).sort((a, b) => b.length - a.length).join("|");
  var ALTITUDE_STRICT = new RegExp(
    `\\b(?:to|at|of|altitude|height|elevation)\\s+(?:an?\\s+)?([0-9][0-9,.]*)\\s*(${ALTITUDE_UNITS})\\b`
  );
  var ALTITUDE_LOOSE = new RegExp(`\\b([0-9][0-9,.]*)\\s*(${ALTITUDE_UNITS})\\b`);
  var ALTITUDE_CUE = /\b(?:zoom|altitude|height|elevation|climb|descend|rise)\b/;
  function extractAltitude(text) {
    const match = text.match(ALTITUDE_STRICT) ?? (ALTITUDE_CUE.test(text) ? text.match(ALTITUDE_LOOSE) : null);
    if (!match) return { value: null, rest: text };
    const amount = Number.parseFloat((match[1] ?? "").replace(/,/g, ""));
    const factor = METRES_PER_UNIT2[match[2] ?? ""];
    if (!Number.isFinite(amount) || factor === void 0) return { value: null, rest: text };
    return { value: round3(amount * factor, 3), rest: text.replace(match[0], " ") };
  }
  var DURATION_UNITS = Object.keys(SECONDS_PER_UNIT).sort((a, b) => b.length - a.length).join("|");
  var WORD_NUMBER_KEYS = Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join("|");
  var DURATION_RE = new RegExp(
    // The optional article covers "half a second" and "a couple of seconds".
    `\\b(?:for|over|during|in|lasting|of)?\\s*(?:(${WORD_NUMBER_KEYS})(?:\\s+of)?(?:\\s+an?)?|([0-9][0-9,.]*))\\s*(${DURATION_UNITS})\\b`
  );
  function extractDuration(text) {
    const match = text.match(DURATION_RE);
    if (!match) return { value: null, rest: text };
    const amount = match[1] !== void 0 ? WORD_NUMBERS[match[1]] : Number.parseFloat((match[2] ?? "").replace(/,/g, ""));
    const factor = SECONDS_PER_UNIT[match[3] ?? ""];
    if (amount === void 0 || !Number.isFinite(amount) || factor === void 0) {
      return { value: null, rest: text };
    }
    return { value: round3(amount * factor, 3), rest: text.replace(match[0], " ") };
  }
  function extractPlace(text) {
    const match = PLACE_PREPOSITION.exec(text);
    if (match?.index !== void 0) {
      const before = text.slice(0, match.index);
      const after = text.slice(match.index + match[0].length);
      const boundary = after.match(PLACE_TAIL_BOUNDARY);
      const phraseRaw = boundary?.index === void 0 ? after : after.slice(0, boundary.index);
      const tail = boundary?.index === void 0 ? "" : after.slice(boundary.index);
      const phrase = cleanPlace(phraseRaw);
      if (phrase !== null) return { value: phrase, rest: `${before} ${tail} ` };
    }
    return fallbackPlace(text);
  }
  function fallbackPlace(text) {
    const kept = [];
    const consumed = [];
    for (const token of text.split(/\s+/)) {
      const bare = token.replace(/[^\p{L}\p{N}'-]/gu, "");
      if (bare === "") continue;
      if (FILLER_WORDS.has(bare) || /^[\d.,]+$/.test(bare) || isActionWord(bare) || readDescriptorExact(bare) !== null) {
        kept.push(token);
      } else {
        consumed.push(token);
      }
    }
    const phrase = cleanPlace(consumed.join(" "));
    if (phrase === null) return { value: null, rest: text };
    return { value: phrase, rest: ` ${kept.join(" ")} ` };
  }
  function isActionWord(word) {
    return ACTION_PATTERNS.some(([pattern]) => pattern.test(` ${word} `));
  }
  function cleanPlace(raw) {
    const cleaned = raw.replace(/[^\p{L}\p{N}\s',.-]/gu, " ").replace(/\s+/g, " ").replace(/^(?:the|a|an)\s+/i, "").replace(/[\s,.-]+$/g, "").trim();
    if (cleaned === "" || !new RegExp("\\p{L}", "u").test(cleaned)) return null;
    return cleaned;
  }
  function readDescriptor(text) {
    for (const [pattern, descriptor] of DESCRIPTOR_PATTERNS) {
      if (pattern.test(text)) return descriptor;
    }
    return null;
  }
  function readDescriptorExact(text) {
    const normalised = text.trim().toLowerCase().replace(/\s+/g, " ");
    for (const [pattern, descriptor] of DESCRIPTOR_PATTERNS) {
      if (new RegExp(`^(?:the\\s+)?${pattern.source}$`).test(normalised)) return descriptor;
    }
    return null;
  }
  function readVerb(text) {
    for (const [pattern, action] of ACTION_PATTERNS) {
      if (pattern.test(text)) return action;
    }
    return null;
  }
  function readAction(text, hasPlace, zoom) {
    const verb = readVerb(text);
    if (verb !== null) return verb;
    if (hasPlace) return "fly_to";
    if (zoom !== null) return "zoom_in";
    return null;
  }
  function round3(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  // src/plan-settings.ts
  function applyProjectSettings(base, project) {
    if (project === void 0) return { config: base, warnings: [] };
    const warnings = [];
    const config = { ...base };
    const effective = makeConfig(base);
    if (project.frameRate !== void 0 && project.frameRate !== effective.frameRate) {
      warnings.push({
        code: "PROJECT_FROM_COMMAND",
        message: `The plan asks for ${project.frameRate} fps, so that is what the frames are counted in.`
      });
      config.frameRate = project.frameRate;
    }
    if (project.width !== void 0 && project.height !== void 0) {
      if (project.width !== effective.width || project.height !== effective.height) {
        warnings.push({
          code: "PROJECT_FROM_COMMAND",
          message: `The plan asks for ${project.width}x${project.height}; set that in Earth Studio's project settings.`
        });
      }
      config.width = project.width;
      config.height = project.height;
    }
    return { config, warnings };
  }
  function noteWarnings(notes) {
    if (notes.length === 0) return [];
    const shown = notes.slice(0, 3).map((note) => `"${note.trim()}"`);
    const rest = notes.length - shown.length;
    return [
      {
        code: "TABLE_IS_THE_SHOT",
        message: `The keyframe table is the whole shot, so everything beside it was read as a note: ${shown.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}.`
      }
    ];
  }

  // src/timeline.ts
  async function resolveSteps(parsed, geocoder, config, options = {}) {
    const { implicitStart = true, onAmbiguous } = options;
    const warnings = [];
    const tabled = parsed.some((step2) => step2.atSeconds !== null);
    if (tabled) {
      let previousAt = 0;
      for (const step2 of parsed) {
        if (step2.atSeconds === null) continue;
        const span = round4(step2.atSeconds - previousAt, 3);
        if (span < 0) {
          warnings.push({
            code: "KEYFRAME_OUT_OF_ORDER",
            stepIndex: step2.index,
            message: `This keyframe is timed at ${step2.atSeconds}s, before the one above it; it was kept where it is.`
          });
        }
        step2.durationSeconds = span > 0 ? span : null;
        previousAt = step2.atSeconds;
      }
    }
    const steps = implicitStart && !tabled && parsed[0]?.action !== "start" ? [{
      index: 0,
      action: "start",
      placeQuery: null,
      zoom: null,
      fromZoom: null,
      altitudeMeters: null,
      durationSeconds: null,
      atSeconds: null,
      tiltDegrees: null,
      panDegrees: null,
      rollDegrees: null,
      fieldOfViewDegrees: null,
      speedScale: null,
      source: "(implicit establishing pose)"
    }, ...parsed] : [...parsed];
    steps.forEach((step2, i) => {
      step2.index = i + 1;
    });
    const places = /* @__PURE__ */ new Map();
    const dropped = /* @__PURE__ */ new Set();
    let firstFailure = null;
    for (const step2 of steps) {
      if (step2.placeQuery === null) continue;
      let place;
      try {
        place = await geocoder.resolve(step2.placeQuery, step2.index);
      } catch (error) {
        if (!(error instanceof AgentError) || error.code !== "PLACE_NOT_FOUND") throw error;
        firstFailure = firstFailure ?? error;
        const describesCamera = step2.action !== "fly_to" || step2.zoom !== null || step2.altitudeMeters !== null || step2.durationSeconds !== null || step2.tiltDegrees !== null || step2.fieldOfViewDegrees !== null || step2.speedScale !== null;
        warnings.push({
          code: "PLACE_NOT_FOUND",
          stepIndex: step2.index,
          message: describesCamera ? `"${step2.placeQuery}" is not a place, so this step stays where the one before it left off.` : `"${step2.placeQuery}" is not a place and the step says nothing else, so it was left out.`
        });
        step2.placeQuery = null;
        if (!describesCamera) dropped.add(step2.index);
        continue;
      }
      if (place.ambiguous && onAmbiguous !== void 0) {
        place = await onAmbiguous(place, step2.index);
      }
      places.set(step2.index, place);
      if (place.ambiguous) {
        const alt = place.alternatives[0];
        warnings.push({
          code: "AMBIGUOUS_PLACE",
          stepIndex: step2.index,
          message: `"${step2.placeQuery}" is ambiguous: used ${describe(place.name, place.context)} (confidence ${place.confidence}); the closest alternative was ${alt ? describe(alt.name, alt.context) : "none"}.`
        });
      }
    }
    if (places.size === 0) {
      if (firstFailure !== null) throw firstFailure;
    }
    for (const index of dropped) {
      const at = steps.findIndex((step2) => step2.index === index);
      if (at !== -1) steps.splice(at, 1);
    }
    steps.forEach((step2, i) => {
      const place = places.get(step2.index);
      if (place !== void 0) {
        places.delete(step2.index);
        places.set(i + 1, place);
      }
      step2.index = i + 1;
    });
    for (let i = 0; i < steps.length; i += 1) {
      const step2 = steps[i];
      if (step2 === void 0 || step2.fromZoom === null) continue;
      const previous = steps[i - 1];
      if (previous === void 0) {
        step2.zoom = step2.zoom ?? step2.fromZoom;
        continue;
      }
      if (previous.action === "hold" || previous.zoom !== null || previous.altitudeMeters !== null) continue;
      previous.zoom = step2.fromZoom;
    }
    const resolved = [];
    let previousAltitude = null;
    let stickyTilt = null;
    let stickyPan = null;
    let stickyRoll = null;
    let stickyFieldOfView = null;
    let stickySpeed = null;
    for (let i = 0; i < steps.length; i += 1) {
      const step2 = steps[i];
      if (step2 === void 0) continue;
      let place = places.get(step2.index) ?? null;
      if (place === null) {
        for (let j = i - 1; j >= 0 && place === null; j -= 1) {
          place = resolved[j]?.place ?? null;
        }
        if (place === null && step2.action === "start") {
          for (let j = i + 1; j < steps.length && place === null; j += 1) {
            const next = steps[j];
            if (next !== void 0) place = places.get(next.index) ?? null;
          }
        }
      }
      if (place === null) {
        throw new AgentError("NO_PLACE_FOR_STEP", `Step ${step2.index} names no place and none can be inherited.`, {
          stepIndex: step2.index,
          detail: `Step text: "${step2.source}"`,
          hint: "Name a place in this step, or put it after a step that does."
        });
      }
      const altitude = decideAltitude(step2, place.kind, previousAltitude, config);
      if (step2.tiltDegrees !== null) stickyTilt = step2.tiltDegrees;
      if (step2.panDegrees !== null) stickyPan = step2.panDegrees;
      if (step2.rollDegrees !== null) stickyRoll = step2.rollDegrees;
      if (step2.fieldOfViewDegrees !== null) stickyFieldOfView = step2.fieldOfViewDegrees;
      if (step2.speedScale !== null) stickySpeed = step2.speedScale;
      const previous = resolved.at(-1);
      const duration = decideDuration(step2, config, previous, { ...place, altitude: altitude.value }, stickySpeed);
      const tilt = decideTilt(stickyTilt, altitude.value, config);
      resolved.push({
        index: step2.index,
        action: step2.action,
        place,
        altitude: altitude.value,
        duration: duration.value,
        altitudeSource: altitude.source,
        durationSource: duration.source,
        tilt: tilt.value,
        tiltSource: tilt.source,
        pan: stickyPan ?? config.defaultPan,
        roll: stickyRoll ?? config.defaultRoll,
        fieldOfView: stickyFieldOfView,
        zoom: step2.zoom,
        source: step2.source
      });
      previousAltitude = altitude.value;
    }
    const firstLens = resolved.find((step2) => step2.fieldOfView !== null)?.fieldOfView ?? null;
    if (firstLens !== null) {
      for (const step2 of resolved) {
        if (step2.fieldOfView === null) step2.fieldOfView = firstLens;
        else break;
      }
    }
    return { steps: resolved, warnings };
  }
  function decideAltitude(step2, placeKind, previous, config) {
    if (step2.altitudeMeters !== null) {
      if (!Number.isFinite(step2.altitudeMeters) || step2.altitudeMeters <= 0) {
        throw new AgentError("INVALID_ALTITUDE", `Step ${step2.index} asks for an altitude of ${step2.altitudeMeters} m.`, {
          stepIndex: step2.index,
          hint: 'Altitude must be greater than zero, e.g. "zoom to 500 meters".'
        });
      }
      return { value: step2.altitudeMeters, source: "explicit" };
    }
    if (step2.zoom !== null) {
      return { value: config.altitudeTable[step2.zoom], source: "descriptor" };
    }
    if (step2.action === "start") {
      return { value: config.startAltitude, source: "descriptor" };
    }
    if (step2.action === "hold" && previous !== null) {
      return { value: previous, source: "inherited" };
    }
    const ladder = altitudeLadder(config);
    const byKind = config.altitudeTable[defaultDescriptorFor(placeKind, config)];
    if (step2.action === "zoom_out") {
      const target = previous === null ? byKind : nextLarger(ladder, previous);
      return { value: target, source: previous === null ? "place-kind" : "descriptor" };
    }
    if (step2.action === "zoom_in") {
      if (previous === null || byKind < previous) return { value: byKind, source: "place-kind" };
      return { value: nextSmaller(ladder, previous), source: "descriptor" };
    }
    return { value: byKind, source: "place-kind" };
  }
  function defaultDescriptorFor(kind, config) {
    return config.descriptorByPlaceKind[kind];
  }
  function altitudeLadder(config) {
    return [...new Set(Object.values(config.altitudeTable))].sort((a, b) => b - a);
  }
  function nextLarger(ladder, current) {
    const larger = [...ladder].reverse().find((value) => value > current * 1.001);
    return larger ?? current * 10;
  }
  function nextSmaller(ladder, current) {
    const smaller = ladder.find((value) => value < current * 0.999);
    return smaller ?? current / 10;
  }
  function decideTilt(explicit, altitude, config) {
    if (explicit !== null) return { value: explicit, source: "explicit" };
    if (config.automaticTilt) return { value: smartTilt(altitude), source: "automatic" };
    return { value: config.defaultTilt, source: "default" };
  }
  function decideDuration(step2, config, previous, here, speedScale) {
    if (step2.durationSeconds !== null) {
      if (!Number.isFinite(step2.durationSeconds) || step2.durationSeconds <= 0) {
        throw new AgentError("INVALID_DURATION", `Step ${step2.index} asks for a duration of ${step2.durationSeconds}s.`, {
          stepIndex: step2.index,
          hint: 'Duration must be greater than zero, e.g. "hold for 3 seconds".'
        });
      }
      return { value: step2.durationSeconds, source: "explicit" };
    }
    if (step2.action === "start") return { value: 0, source: "default" };
    const scale = speedScale ?? 1;
    if (step2.action === "hold") {
      return { value: round4(config.defaultHoldSeconds * scale, 2), source: scale === 1 ? "default" : "automatic" };
    }
    const from = previous?.place;
    if (config.automaticTiming && previous !== void 0 && from !== null && from !== void 0) {
      const seconds = smartDuration(
        { latitude: from.latitude, longitude: from.longitude, altitude: previous.altitude },
        here,
        config.autoDuration
      );
      return { value: round4(seconds * scale, 2), source: "automatic" };
    }
    return { value: round4(config.defaultTransitionSeconds * scale, 2), source: scale === 1 ? "default" : "automatic" };
  }
  function round4(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }
  function buildTimeline(resolved, config, command, warnings = []) {
    if (resolved.length === 0) {
      throw new AgentError("NO_STEPS_PARSED", "There are no steps to build a timeline from.");
    }
    const keyframes = [];
    const allWarnings = [...warnings];
    let frame = 0;
    const first = resolved[0];
    if (first === void 0 || first.place === null) {
      throw new AgentError("NO_PLACE_FOR_STEP", "The first step has no resolved place.");
    }
    keyframes.push(makeKeyframe(0, first, config, "start"));
    if (first.durationSource === "explicit" && first.duration > 0) {
      frame = Math.max(1, Math.round(first.duration * config.frameRate));
      keyframes.push(makeKeyframe(frame, first, config, "end"));
    }
    for (let i = 1; i < resolved.length; i += 1) {
      const step2 = resolved[i];
      if (step2 === void 0 || step2.place === null) continue;
      const span = Math.round(step2.duration * config.frameRate);
      if (span < 1) {
        allWarnings.push({
          code: "DURATION_ROUNDED_UP",
          stepIndex: step2.index,
          message: `Step ${step2.index} lasts ${step2.duration}s, which is under one frame at ${config.frameRate}fps; it was extended to a single frame.`
        });
      }
      frame += Math.max(1, span);
      keyframes.push(makeKeyframe(frame, step2, config, "end"));
    }
    const lastFrame = keyframes.at(-1)?.frame ?? 0;
    return {
      formatVersion: 1,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      command,
      frameRate: config.frameRate,
      width: config.width,
      height: config.height,
      totalFrames: lastFrame + 1,
      durationSeconds: Number((lastFrame / config.frameRate).toFixed(3)),
      writeFieldOfView: config.writeFieldOfView || resolved.some((step2) => step2.fieldOfView !== null),
      steps: resolved,
      keyframes,
      warnings: allWarnings
    };
  }
  function makeKeyframe(frame, step2, config, role) {
    const place = step2.place;
    if (place === null) {
      throw new AgentError("NO_PLACE_FOR_STEP", `Step ${step2.index} has no resolved place.`, { stepIndex: step2.index });
    }
    const camera = {
      latitude: place.latitude,
      longitude: place.longitude,
      altitude: step2.altitude,
      pan: step2.pan,
      tilt: step2.tilt,
      roll: step2.roll,
      fieldOfView: step2.fieldOfView ?? config.defaultFieldOfView
    };
    return {
      frame,
      time: Number((frame / config.frameRate).toFixed(3)),
      stepIndex: step2.index,
      label: `${step2.action} ${place.name} (${role})`,
      camera
    };
  }
  function describe(name, context) {
    return context === void 0 || context === "" ? name : `${name} - ${context}`;
  }

  // src/geocode/providers.ts
  function toCandidate(entry, penalty = 1) {
    return {
      name: entry.name,
      latitude: entry.latitude,
      longitude: entry.longitude,
      kind: entry.kind,
      score: entry.weight * penalty,
      context: entry.context
    };
  }
  var offlineProvider = {
    name: "gazetteer",
    async lookup(query) {
      const exact = lookupExact(query);
      if (exact.length > 0) return exact.map((entry) => toCandidate(entry));
      return lookupFuzzy(query).map((entry) => toCandidate(entry, 0.5));
    }
  };
  var NOMINATIM_KIND = {
    country: "country",
    state: "region",
    region: "region",
    province: "region",
    county: "region",
    city: "city",
    town: "city",
    village: "city",
    municipality: "city",
    hamlet: "city",
    suburb: "city",
    neighbourhood: "city",
    administrative: "region"
  };
  function mapNominatimKind(row) {
    const key = (row.addresstype ?? row.type ?? "").toLowerCase();
    const mapped = NOMINATIM_KIND[key];
    if (mapped) return mapped;
    const category = (row.category ?? row.class ?? "").toLowerCase();
    if (category === "place") return "city";
    if (category === "boundary") return "region";
    if (["tourism", "historic", "natural", "building", "man_made", "leisure", "amenity", "waterway"].includes(category)) {
      return "landmark";
    }
    return "unknown";
  }
  function createNominatimProvider(options = {}) {
    const {
      userAgent = "earth-studio-agent/1.0 (camera path generator)",
      endpoint = "https://nominatim.openstreetmap.org/search",
      limit = 5,
      timeoutMs = 1e4,
      fetchImpl = globalThis.fetch
    } = options;
    return {
      name: "nominatim",
      async lookup(query) {
        if (typeof fetchImpl !== "function") {
          throw new AgentError("GEOCODER_UNAVAILABLE", "No fetch implementation is available for the online geocoder.");
        }
        const url = `${endpoint}?q=${encodeURIComponent(query)}&format=jsonv2&limit=${limit}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let rows;
        try {
          const response = await fetchImpl(url, {
            headers: { "User-Agent": userAgent, Accept: "application/json" },
            signal: controller.signal
          });
          if (!response.ok) {
            throw new AgentError(
              "GEOCODER_UNAVAILABLE",
              `Online geocoder returned HTTP ${response.status} for "${query}".`,
              { hint: "Re-run with --offline to use only the built-in place table." }
            );
          }
          rows = await response.json();
        } catch (cause) {
          if (cause instanceof AgentError) throw cause;
          throw new AgentError("GEOCODER_UNAVAILABLE", `Online geocoder request failed for "${query}".`, {
            detail: cause instanceof Error ? cause.message : String(cause),
            hint: "Re-run with --offline to use only the built-in place table.",
            cause
          });
        } finally {
          clearTimeout(timer);
        }
        if (!Array.isArray(rows)) return [];
        return rows.flatMap((row) => {
          const latitude = Number.parseFloat(row.lat ?? "");
          const longitude = Number.parseFloat(row.lon ?? "");
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
          return [{
            name: row.name && row.name !== "" ? row.name : row.display_name ?? query,
            latitude,
            longitude,
            kind: mapNominatimKind(row),
            // importance is 0..1; scale it so it can be compared with itself.
            score: Math.max(1, Math.round((row.importance ?? 0.1) * 1e6)),
            context: row.display_name
          }];
        });
      }
    };
  }

  // src/geocode/index.ts
  var Geocoder = class {
    providers;
    ambiguityRatio;
    cache;
    constructor(options = {}) {
      this.providers = options.providers ?? [offlineProvider];
      this.ambiguityRatio = options.ambiguityRatio ?? 0.6;
      this.cache = options.cache ?? /* @__PURE__ */ new Map();
      if (this.providers.length === 0) {
        throw new AgentError("INVALID_CONFIG", "The geocoder needs at least one provider.");
      }
    }
    /** Resolves one place name. Throws AgentError('PLACE_NOT_FOUND') if nothing matches. */
    async resolve(query, stepIndex) {
      const key = query.trim().toLowerCase();
      const cached = this.cache.get(key);
      if (cached) return cached;
      const at = parseCoordinates(query);
      if (at !== null) {
        const place = coordinatePlace(query, at);
        this.cache.set(key, place);
        return place;
      }
      const failures = [];
      for (const provider of this.providers) {
        let candidates;
        try {
          candidates = await provider.lookup(query);
        } catch (cause) {
          failures.push(cause instanceof Error ? `${provider.name}: ${cause.message}` : String(cause));
          continue;
        }
        if (candidates.length === 0) continue;
        const place = this.rank(query, provider.name, candidates);
        this.cache.set(key, place);
        return place;
      }
      const hasOnline = this.providers.some((provider) => provider.name !== "gazetteer");
      throw new AgentError("PLACE_NOT_FOUND", `Could not resolve the place "${query}".`, {
        stepIndex,
        detail: failures.length > 0 ? failures.join("; ") : `Tried: ${this.providers.map((p) => p.name).join(", ")}.`,
        hint: hasOnline ? "Check the spelling, or use a name the online geocoder knows." : "Check the spelling, or add --online to look the place up on OpenStreetMap."
      });
    }
    /** Sorts candidates, picks the winner, and works out whether it is ambiguous. */
    rank(query, provider, candidates) {
      const sorted = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      const winner = sorted[0];
      if (winner === void 0) {
        throw new AgentError("PLACE_NOT_FOUND", `Could not resolve the place "${query}".`);
      }
      const runnerUp = sorted[1];
      const ambiguous = runnerUp !== void 0 && (runnerUp.score >= winner.score * this.ambiguityRatio || runnerUp.kind !== winner.kind);
      const confidence = runnerUp === void 0 ? 1 : winner.score / (winner.score + runnerUp.score);
      return {
        query,
        name: winner.name,
        latitude: winner.latitude,
        longitude: winner.longitude,
        kind: winner.kind,
        context: winner.context,
        provider,
        confidence: Number(confidence.toFixed(3)),
        ambiguous,
        alternatives: sorted.slice(1, 5)
      };
    }
  };

  // src/driver/selectors.ts
  var CAMERA_FIELD_ORDER = [
    "latitude",
    "longitude",
    "altitude",
    "pan",
    "tilt",
    "roll",
    "fieldOfView"
  ];
  var VALUE_WIDGET = ".scrub-input.valueInput";
  var DEFAULT_SELECTORS = {
    version: "2.0.0",
    verifiedOn: "2026-09-06",
    appReady: {
      label: "attribute panel",
      required: true,
      // The attribute list is the thing the driver actually needs; a body match
      // would say nothing, which is how an earlier version passed on a page that
      // had not loaded the editor at all.
      candidates: ['[data-attribute-type="latitude"]', ".attribute-list", ".timeline-attributes"]
    },
    playhead: {
      readout: {
        label: "timecode readout",
        required: true,
        candidates: ["li.control.timecode", ".playback-controls .timecode", '[data-value="model.timecode"]']
      },
      jumpStart: {
        label: "jump to start",
        required: false,
        candidates: ['[data-action="click:jumpWorkspaceStart"]']
      },
      forward: {
        label: "next frame",
        required: false,
        candidates: ['[data-action="click:forward"]']
      },
      backward: {
        label: "previous frame",
        required: false,
        candidates: ['[data-action="click:backward"]']
      }
    },
    camera: {
      latitude: { label: "camera latitude", attributeType: "latitude", widget: VALUE_WIDGET, plannedUnit: "degrees", required: true },
      longitude: { label: "camera longitude", attributeType: "longitude", widget: VALUE_WIDGET, plannedUnit: "degrees", required: true },
      altitude: { label: "camera altitude", attributeType: "altitude", widget: VALUE_WIDGET, plannedUnit: "metres", required: true },
      // Earth Studio names the rotations by axis: X is Pan, Y is Tilt, Z is Roll.
      pan: { label: "camera pan", attributeType: "rotationX", widget: VALUE_WIDGET, plannedUnit: "degrees", required: false },
      tilt: { label: "camera tilt", attributeType: "rotationY", widget: VALUE_WIDGET, plannedUnit: "degrees", required: false },
      roll: { label: "camera roll", attributeType: "rotationZ", widget: VALUE_WIDGET, plannedUnit: "degrees", required: false },
      fieldOfView: { label: "camera field of view", attributeType: "fov", widget: VALUE_WIDGET, plannedUnit: "degrees", required: false }
    }
  };
  function rowSelector(attribute) {
    return `[data-attribute-type="${attribute.attributeType}"]`;
  }
  function widgetSelector(attribute) {
    return `${rowSelector(attribute)} ${attribute.widget}`;
  }

  // src/driver/units.ts
  function metresPerDisplayUnit(unitTitle) {
    const normalised = unitTitle.trim().toLowerCase();
    if (normalised.startsWith("kilomet")) return 1e3;
    if (normalised.startsWith("mile")) return 1609.344;
    if (normalised.startsWith("feet") || normalised.startsWith("foot")) return 0.3048;
    return 1;
  }
  function metresPerEditUnit(unitTitle, displayed, editBox) {
    const perDisplay = metresPerDisplayUnit(unitTitle);
    if (!Number.isFinite(displayed) || !Number.isFinite(editBox) || displayed === 0 || editBox === 0) {
      return perDisplay;
    }
    const raw = Math.abs(displayed * perDisplay / editBox);
    if (!Number.isFinite(raw) || raw <= 0) return perDisplay;
    const snapped = 10 ** Math.round(Math.log10(raw));
    if (raw / snapped > 1.2 || snapped / raw > 1.2) return perDisplay;
    const swing = snapped / perDisplay;
    if (swing < 1e-3 || swing > 1e3) return perDisplay;
    return snapped;
  }
  function parseDisplayedNumber(text) {
    const cleaned = text.replace(/[^0-9eE+.-]/g, "");
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) ? value : Number.NaN;
  }
  function readbackTolerance(planned, metresPerDisplay) {
    const displayRounding = 5e-4 * metresPerDisplay * 2;
    return Math.max(displayRounding, Math.abs(planned) * 1e-5);
  }

  // src/driver/attribute-writer.ts
  var rowSelector2 = (type) => `[data-attribute-type="${type}"]`;
  async function readRow(page, target, row = rowSelector2(target.attributeType)) {
    if (typeof page.evaluate !== "function") {
      throw new AgentError("DRIVER_NOT_READY", "This page cannot be read.");
    }
    const widget = `${row} ${target.widget}`;
    return page.evaluate(
      ({ row: rowSelectorText, widget: widgetSelectorText }) => {
        const widgetNode = document.querySelector(widgetSelectorText);
        const rowNode = document.querySelector(rowSelectorText);
        const button = rowNode === null ? null : rowNode.querySelector('[data-action="click:addKeyframe"]');
        if (widgetNode === null) {
          return {
            found: false,
            displayed: "",
            unitTitle: "",
            editBox: null,
            hasKeyframe: false,
            hasKeyframeButton: button !== null
          };
        }
        const box = widgetNode.querySelector('[contenteditable="true"], [contenteditable=""]');
        return {
          found: true,
          displayed: widgetNode.querySelector(".presentedValue")?.textContent ?? "",
          unitTitle: widgetNode.querySelector(".unit")?.getAttribute("title") ?? "",
          editBox: box === null ? null : box.textContent ?? "",
          hasKeyframe: button !== null && button.classList.contains("has-keyframe"),
          hasKeyframeButton: button !== null
        };
      },
      { row, widget }
    );
  }
  async function writeAttribute(page, target, planned, options = {}) {
    const { addKeyframe = true, timeoutMs = 1e4, settleTimeoutMs = 4e3 } = options;
    if (typeof page.click !== "function" || page.keyboard === void 0) {
      throw new AgentError("DRIVER_NOT_READY", "This page cannot be driven.", {
        detail: "The page object provides no click() or keyboard."
      });
    }
    const row = await pickRow(page, target);
    const widget = `${row} ${target.widget}`;
    const before = await readRow(page, target, row);
    if (!before.found) {
      throw new AgentError("DRIVER_FIELD_WRITE_FAILED", `No ${target.label} row is on the page.`, {
        detail: `Looked for ${widget}`,
        hint: 'Run "earth-studio-agent probe" to list the attribute rows this project actually shows.'
      });
    }
    await openEditor(page, widget, target, rowSelector2(target.attributeType), timeoutMs);
    const opened = await readRow(page, target, row);
    const displayed = parseDisplayedNumber(before.displayed);
    const editBoxValue = parseDisplayedNumber(opened.editBox ?? "");
    const perDisplay = metresPerDisplayUnit(before.unitTitle);
    const perEdit = target.plannedUnit === "metres" ? metresPerEditUnit(before.unitTitle, displayed, editBoxValue) : 1;
    const typed = target.plannedUnit === "metres" ? planned / perEdit : planned;
    const editSelector = `${widget} [contenteditable]`;
    const text = formatForField(typed);
    try {
      await page.fill(editSelector, text, { timeout: timeoutMs });
    } catch {
      await page.keyboard.press("Control+a");
      await page.keyboard.type(text);
    }
    try {
      await page.press(editSelector, "Enter", { timeout: timeoutMs });
    } catch {
      await page.keyboard.press("Enter");
    }
    if (await stillEditing(page, target, row)) {
      await page.keyboard.press("Enter");
      if (await stillEditing(page, target, row)) {
        await page.keyboard.press("Escape");
        throw new AgentError("DRIVER_FIELD_WRITE_FAILED", `The ${target.label} field would not commit ${planned}.`, {
          detail: `Typed ${text}, but the edit box stayed open, so the value was never applied.`,
          hint: `Selector used: ${editSelector}`
        });
      }
    }
    const toPlanned = (row2) => {
      const value = parseDisplayedNumber(row2.displayed);
      return target.plannedUnit === "metres" ? value * metresPerDisplayUnit(row2.unitTitle) : value;
    };
    const toleranceFor = (row2) => readbackTolerance(planned, target.plannedUnit === "metres" ? metresPerDisplayUnit(row2.unitTitle) : 1);
    const deadline = Date.now() + settleTimeoutMs;
    let after = await readRow(page, target, row);
    let readback = toPlanned(after);
    let tolerance = toleranceFor(after);
    while (Date.now() < deadline && (!Number.isFinite(readback) || Math.abs(readback - planned) > tolerance || after.editBox !== null)) {
      await new Promise((done) => setTimeout(done, 100));
      after = await readRow(page, target, row);
      readback = toPlanned(after);
      tolerance = toleranceFor(after);
    }
    if (!Number.isFinite(readback) || Math.abs(readback - planned) > tolerance) {
      throw new AgentError("DRIVER_FIELD_WRITE_FAILED", `The ${target.label} field did not take ${planned}.`, {
        detail: `Typed ${formatForField(typed)} into a field reading in ${before.unitTitle || "unknown units"} (one edit-box unit = ${perEdit} m); after ${settleTimeoutMs}ms it shows "${after.displayed}" ${after.unitTitle || "in unknown units"}, which is ${readback} against the ${planned} that was wanted.`,
        hint: `Selector used: ${widget}`
      });
    }
    let keyframed = false;
    if (addKeyframe) {
      keyframed = await ensureKeyframe(page, target, row, after, timeoutMs);
    }
    return {
      attributeType: target.attributeType,
      planned,
      typed,
      displayUnit: before.unitTitle,
      metresPerEditUnit: perEdit,
      readback,
      keyframed
    };
  }
  async function ensureKeyframe(page, target, row, after, timeoutMs) {
    if (after.hasKeyframe) return true;
    if (!after.hasKeyframeButton) {
      throw new AgentError("DRIVER_FIELD_WRITE_FAILED", `The ${target.label} row has no keyframe button.`, {
        detail: `Looked for ${row} [data-action="click:addKeyframe"]`,
        hint: 'The value was set, but it is not a keyframe. Run "earth-studio-agent probe" to see the row.'
      });
    }
    const button = `${row} [data-action="click:addKeyframe"]`;
    const attempts = [];
    const ways = [
      ["hover and click", async () => {
        if (typeof page.hover === "function") await page.hover(row, { timeout: timeoutMs });
        await page.click(button, { timeout: timeoutMs });
      }],
      ["forced click", async () => page.click(button, { timeout: timeoutMs, force: true })],
      ["click from inside the page", async () => {
        if (typeof page.evaluate !== "function") throw new Error("the page cannot run script");
        const clicked = await page.evaluate((selector) => {
          const node = document.querySelector(selector);
          if (node === null) return false;
          node.click();
          return true;
        }, button);
        if (!clicked) throw new Error("the button is not in the page");
      }]
    ];
    let landed = false;
    for (const [name, attempt] of ways) {
      try {
        await attempt();
      } catch (cause) {
        attempts.push(`${name}: ${describe2(cause)}`);
        continue;
      }
      if (await keyframeAppeared(page, target, row)) {
        landed = true;
        break;
      }
      attempts.push(`${name}: no keyframe appeared`);
    }
    if (!landed) {
      throw new AgentError("DRIVER_FIELD_WRITE_FAILED", `Could not add a keyframe for ${target.label}.`, {
        detail: attempts.join("; "),
        hint: 'The value was set, but it is not a keyframe. Run "earth-studio-agent probe --buttons" to see the control.'
      });
    }
    return true;
  }
  async function stillEditing(page, target, row) {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      if ((await readRow(page, target, row)).editBox === null) return false;
      await new Promise((done) => setTimeout(done, 100));
    }
    return true;
  }
  async function keyframeAppeared(page, target, row) {
    const deadline = Date.now() + 2e3;
    while (Date.now() < deadline) {
      if ((await readRow(page, target, row)).hasKeyframe) return true;
      await new Promise((done) => setTimeout(done, 100));
    }
    return false;
  }
  function describe2(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.split("\n")[0] ?? message;
  }
  function formatForField(value) {
    if (!Number.isFinite(value)) return "0";
    if (Number.isInteger(value)) return value.toLocaleString("fullwide", { useGrouping: false, maximumFractionDigits: 0 });
    return value.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  }
  var GESTURES = ["click", "pointer", "mouse", "native", "dblclick"];
  async function openEditor(page, widget, target, originalRow, timeoutMs) {
    const label = target.label;
    const edit = `${widget} [contenteditable]`;
    const tried = [];
    let lastError;
    let budget = timeoutMs;
    for (const gesture of GESTURES) {
      if (await isOpen(page, edit)) return;
      tried.push(gesture);
      try {
        if (gesture === "click") await page.click?.(widget, { timeout: timeoutMs });
        else await gestureAt(page, widget, gesture);
      } catch (cause) {
        lastError = cause;
      }
      if (await waitOpen(page, edit, budget)) return;
      budget = 1200;
    }
    throw new AgentError("DRIVER_FIELD_WRITE_FAILED", `The ${label} field did not open for editing.`, {
      detail: `Tried ${tried.join(", ")} on ${widget}` + (lastError instanceof Error ? `; last error: ${lastError.message.split("\n")[0]}` : ""),
      // Every candidate, not just the one that was tried. Without a terminal -
      // which is the whole point of the extension - this message is the only way
      // to see whether the field simply ignored the click or whether the wrong
      // element was clicked all along.
      hint: `Candidates for ${originalRow} ${target.widget}: ${await describeMatches(page, `${originalRow} ${target.widget}`)}`,
      cause: lastError
    });
  }
  async function pickRow(page, target) {
    const plain = rowSelector2(target.attributeType);
    if (typeof page.evaluate !== "function") return plain;
    const marked = await page.evaluate(
      (input) => {
        const rows = Array.from(document.querySelectorAll(input.row));
        for (const node of Array.from(document.querySelectorAll(`[data-agent-row="${input.mark}"]`))) {
          node.removeAttribute("data-agent-row");
        }
        if (rows.length === 0) return false;
        const score = (node) => {
          const field = node.querySelector(input.widget);
          if (field === null) return -1;
          const box = field.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return 0;
          const style = getComputedStyle(field);
          if (style.visibility === "hidden" || style.display === "none") return 0;
          return box.width * box.height;
        };
        let best = rows[0];
        let bestScore = score(best);
        for (const node of rows.slice(1)) {
          const value = score(node);
          if (value > bestScore) {
            best = node;
            bestScore = value;
          }
        }
        best.setAttribute("data-agent-row", input.mark);
        return true;
      },
      { row: plain, widget: target.widget, mark: target.attributeType }
    );
    return marked ? `[data-agent-row="${target.attributeType}"]` : plain;
  }
  async function describeMatches(page, selector) {
    if (typeof page.evaluate !== "function") return selector;
    try {
      return await page.evaluate((query) => {
        const nodes = Array.from(document.querySelectorAll(query));
        if (nodes.length === 0) return "none on the page at all";
        return nodes.map((node, index) => {
          const box = node.getBoundingClientRect();
          const centreX = box.left + box.width / 2;
          const centreY = box.top + box.height / 2;
          const under = document.elementFromPoint(centreX, centreY);
          const covered = under === null ? "off-screen" : node.contains(under) ? "clickable" : `covered by <${under.tagName.toLowerCase()} class="${under.className}">`;
          return `#${index + 1} <${node.tagName.toLowerCase()} class="${node.className}"> ${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.left)},${Math.round(box.top)} text "${(node.textContent ?? "").trim().slice(0, 24)}" ${covered}`;
        }).join(" | ");
      }, selector);
    } catch {
      return selector;
    }
  }
  async function isOpen(page, edit) {
    if (typeof page.evaluate !== "function") return false;
    return page.evaluate((selector) => {
      const node = document.querySelector(selector);
      if (node === null) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 || box.height > 0;
    }, edit);
  }
  async function waitOpen(page, edit, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    do {
      if (await isOpen(page, edit)) return true;
      await new Promise((done) => setTimeout(done, 80));
    } while (Date.now() < deadline);
    return false;
  }
  async function gestureAt(page, selector, kind) {
    if (typeof page.evaluate !== "function") return;
    await page.evaluate((input) => {
      const element = document.querySelector(input.selector);
      if (element === null) return;
      element.scrollIntoView?.({ block: "center", inline: "center" });
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const under = document.elementFromPoint(x, y);
      const target = under !== null && element.contains(under) ? under : element;
      const fire = (type, extra) => {
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          button: 0,
          detail: 1,
          ...extra
        };
        const pointer = type.startsWith("pointer") && typeof PointerEvent === "function";
        target.dispatchEvent(
          pointer ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true, width: 1, height: 1 }) : new MouseEvent(type, init)
        );
      };
      if (input.kind === "native") {
        target.click();
        return;
      }
      if (input.kind === "dblclick") {
        for (const detail of [1, 2]) {
          fire("mousedown", { buttons: 1, detail });
          fire("mouseup", { buttons: 0, detail });
          fire("click", { detail });
        }
        fire("dblclick", { detail: 2 });
        return;
      }
      const usePointer = input.kind === "pointer";
      if (usePointer) {
        fire("pointerover", { buttons: 0 });
        fire("pointerenter", { buttons: 0 });
      }
      fire("mouseover", { buttons: 0 });
      fire("mouseenter", { buttons: 0 });
      if (usePointer) fire("pointermove", { buttons: 0 });
      fire("mousemove", { buttons: 0 });
      if (usePointer) fire("pointerdown", { buttons: 1, pressure: 0.5 });
      fire("mousedown", { buttons: 1 });
      target.closest("[tabindex]")?.focus?.();
      if (usePointer) fire("pointerup", { buttons: 0 });
      fire("mouseup", { buttons: 0 });
      fire("click", {});
    }, { selector, kind });
  }

  // src/driver/playhead.ts
  var READOUT = "li.control.timecode";
  var COARSE_STEP = 5;
  var JUMP_START = '[data-action="click:jumpWorkspaceStart"]';
  var STEP_FORWARD = '[data-action="click:forward"]';
  async function readFrame(page, readout = READOUT, settleMs = 250) {
    if (typeof page.evaluate !== "function") {
      throw new AgentError("DRIVER_NOT_READY", "This page cannot be read.");
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const text = await page.evaluate((selector) => {
        const node = document.querySelector(selector);
        return node === null ? "" : (node.textContent ?? "").trim();
      }, readout);
      if (/^-?\d+$/.test(text)) return Number(text);
      if (text === "") {
        throw new AgentError("DRIVER_FRAME_SEEK_FAILED", "The timecode readout is not on the page.", {
          detail: `Looked for ${readout}`,
          hint: 'Run "earth-studio-agent probe --playhead" to check the timeline controls.'
        });
      }
      if (typeof page.click !== "function") break;
      await page.click(readout, { timeout: 5e3 });
      await pause(settleMs);
    }
    throw new AgentError("DRIVER_FRAME_SEEK_FAILED", "The timecode readout never showed a frame number.", {
      hint: "Click the timecode in Earth Studio until it shows frames, then re-run."
    });
  }
  async function releaseFocus(page) {
    if (typeof page.evaluate !== "function") return;
    await page.evaluate(() => {
      const active = document.activeElement;
      active?.blur?.();
      document.body?.focus?.();
    });
  }
  async function seekToFrame(page, frame, options = {}) {
    const { readout = READOUT, settleMs = 250, maxPresses = 4e3 } = options;
    if (!Number.isInteger(frame) || frame < 0) {
      throw new AgentError("DRIVER_FRAME_SEEK_FAILED", `Frame ${frame} is not a frame number.`);
    }
    if (page.keyboard === void 0) {
      throw new AgentError("DRIVER_NOT_READY", "This page has no keyboard to drive.");
    }
    await releaseFocus(page);
    const from = await readFrame(page, readout, settleMs);
    if (from === frame) return { from, to: frame, presses: 0, corrected: false };
    let presses = await step(page, frame - from, maxPresses);
    await pause(settleMs);
    let landed = await readFrame(page, readout, settleMs);
    if (landed === frame) return { from, to: landed, presses, corrected: false };
    presses += await jumpToStart(page, settleMs);
    presses += await step(page, frame, maxPresses);
    await pause(settleMs);
    landed = await readFrame(page, readout, settleMs);
    if (landed === frame) return { from, to: landed, presses, corrected: true };
    if (landed === 0 && typeof page.click === "function") {
      presses += await clickForward(page, frame, maxPresses);
      await pause(settleMs);
      landed = await readFrame(page, readout, settleMs);
      if (landed === frame) return { from, to: landed, presses, corrected: true };
    }
    if (landed < frame) {
      const lastFrame = await findLastFrame(page, readout, settleMs);
      if (lastFrame !== null && lastFrame > 0 && lastFrame < frame) {
        throw new AgentError("DRIVER_FRAME_SEEK_FAILED", `This path needs frame ${frame}, past the end of the project.`, {
          detail: `The timeline ends at frame ${lastFrame}.`,
          hint: `Lengthen the project in Earth Studio, or shorten the path - a higher frame rate or shorter holds will both bring it in.`
        });
      }
    }
    throw new AgentError("DRIVER_FRAME_SEEK_FAILED", `The playhead would not move to frame ${frame}.`, {
      detail: `It sits at frame ${landed} after ${presses} attempts.`,
      hint: 'Run "earth-studio-agent probe --playhead" to see what the timeline controls are doing.'
    });
  }
  async function step(page, delta, maxPresses) {
    if (page.keyboard === void 0 || delta === 0) return 0;
    const forward = delta > 0;
    const distance = Math.abs(delta);
    const coarse = Math.floor(distance / COARSE_STEP);
    const fine = distance % COARSE_STEP;
    const total = coarse + fine;
    if (total > maxPresses) {
      throw new AgentError("DRIVER_FRAME_SEEK_FAILED", `Moving ${distance} frames would take ${total} key presses.`, {
        hint: "Raise maxPresses, or shorten the path."
      });
    }
    const coarseKey = forward ? "Shift+ArrowRight" : "Shift+ArrowLeft";
    const fineKey = forward ? "ArrowRight" : "ArrowLeft";
    for (let press = 0; press < coarse; press += 1) await page.keyboard.press(coarseKey);
    for (let press = 0; press < fine; press += 1) await page.keyboard.press(fineKey);
    return total;
  }
  async function findLastFrame(page, readout = READOUT, settleMs = 250) {
    if (page.keyboard === void 0) return null;
    try {
      await releaseFocus(page);
      await page.keyboard.press("End");
      await pause(settleMs);
      return await readFrame(page, readout, settleMs);
    } catch {
      return null;
    }
  }
  async function jumpToStart(page, settleMs) {
    if (typeof page.click === "function") {
      try {
        await page.click(JUMP_START, { timeout: 5e3 });
        await pause(settleMs);
        await releaseFocus(page);
        return 1;
      } catch {
      }
    }
    if (page.keyboard !== void 0) {
      await page.keyboard.press("Home");
      await pause(settleMs);
      return 1;
    }
    return 0;
  }
  async function clickForward(page, frames, maxPresses) {
    if (typeof page.click !== "function") return 0;
    if (frames > maxPresses) {
      throw new AgentError("DRIVER_FRAME_SEEK_FAILED", `Stepping ${frames} frames by button would take ${frames} clicks.`, {
        hint: "Raise maxPresses, or shorten the path."
      });
    }
    for (let click = 0; click < frames; click += 1) {
      try {
        await page.click(STEP_FORWARD, { timeout: 5e3 });
      } catch {
        return click;
      }
    }
    return frames;
  }
  function pause(ms) {
    return new Promise((done) => setTimeout(done, ms));
  }

  // src/driver/earth-studio-driver.ts
  var EARTH_STUDIO_URL = "https://earth.google.com/studio/";
  var EarthStudioDriver = class {
    page;
    selectors;
    timeoutMs;
    settleMs;
    addKeyframes;
    onProgress;
    constructor(page, options = {}) {
      this.page = page;
      this.selectors = options.selectors ?? DEFAULT_SELECTORS;
      this.timeoutMs = options.timeoutMs ?? 15e3;
      this.settleMs = options.settleMs ?? 250;
      this.addKeyframes = options.addKeyframes ?? true;
      this.onProgress = options.onProgress;
    }
    /** Navigates to Earth Studio and waits for the attribute panel to appear. */
    async open(url = EARTH_STUDIO_URL, options = {}) {
      if (options.navigate !== false) {
        await this.page.goto(url, { waitUntil: "load", timeout: this.timeoutMs });
      }
      if (await this.matchOne(this.selectors.appReady) === null) {
        throw new AgentError("DRIVER_NOT_READY", "The Earth Studio attribute panel is not on this page.", {
          detail: `None of these matched: ${this.selectors.appReady.candidates.join(", ")}`,
          hint: 'Open your Earth Studio project first. "earth-studio-agent probe" lists what the page is showing.'
        });
      }
    }
    /** Checks every selector against the live page (PRD 11: version-check on each run). */
    async verifyLayout() {
      const fields = [];
      for (const [name, field] of [
        ["attribute panel", this.selectors.appReady],
        ["timecode readout", this.selectors.playhead.readout],
        ["jump to start", this.selectors.playhead.jumpStart],
        ["next frame", this.selectors.playhead.forward],
        ["previous frame", this.selectors.playhead.backward]
      ]) {
        const matched = await this.matchOne(field);
        fields.push({ name, label: field.label, required: field.required, matched, candidates: field.candidates });
      }
      for (const name of CAMERA_FIELD_ORDER) {
        const attribute = this.selectors.camera[name];
        const selector = widgetSelector(attribute);
        const usable = await this.isUsable(selector);
        fields.push({
          name,
          label: attribute.label,
          required: attribute.required,
          matched: usable ? selector : null,
          note: !usable && await this.exists(selector) ? "on the page but not shown" : void 0,
          candidates: [selector]
        });
      }
      const missing = fields.filter((field) => field.required && field.matched === null).map((field) => field.label);
      return { version: this.selectors.version, verifiedOn: this.selectors.verifiedOn, ok: missing.length === 0, fields, missing };
    }
    /**
     * Writes every keyframe of the plan into the open Earth Studio project.
     *
     * FR6: a failure names the step, the frame and the field. By default the run
     * stops there; `continueOnError` records it and carries on, so one bad field
     * does not hide the rest.
     */
    async applyPath(path, options = {}) {
      const layout = await this.verifyLayout();
      if (!layout.ok) {
        throw new AgentError("DRIVER_LAYOUT_MISMATCH", "The Earth Studio page does not expose the fields the driver needs.", {
          detail: `Missing: ${layout.missing.join(", ")} (selector set ${layout.version}, verified ${layout.verifiedOn})`,
          hint: 'Run "earth-studio-agent probe" to see the attribute rows this project shows, then update src/driver/selectors.ts.'
        });
      }
      const needed = path.keyframes.at(-1)?.frame ?? 0;
      const lastFrame = await findLastFrame(this.page);
      if (lastFrame !== null && lastFrame > 0 && lastFrame < needed) {
        const seconds = ((needed + 1) / path.frameRate).toFixed(1);
        throw new AgentError("DRIVER_FRAME_SEEK_FAILED", `This path is longer than the project.`, {
          detail: `It needs ${needed + 1} frames (${seconds}s at ${path.frameRate}fps); the timeline ends at frame ${lastFrame}.`,
          hint: `Lengthen the project in Earth Studio - its duration is in the project settings - or shorten the path. Nothing has been written.`
        });
      }
      const results = [];
      for (const keyframe of path.keyframes) {
        try {
          results.push(await this.applyKeyframe(keyframe, { writeFieldOfView: path.writeFieldOfView }));
        } catch (cause) {
          const result = {
            frame: keyframe.frame,
            stepIndex: keyframe.stepIndex,
            label: keyframe.label,
            written: {},
            skipped: [],
            details: [],
            ok: false,
            // format() keeps the inner detail and hint; message alone would throw
            // away the actual reason and leave only the outer summary.
            error: cause instanceof AgentError ? cause.format() : cause instanceof Error ? cause.message : String(cause)
          };
          results.push(result);
          if (options.continueOnError !== true) {
            const done = results.filter((entry) => entry.ok).length;
            throw new AgentError(
              "DRIVER_FIELD_WRITE_FAILED",
              `Stopped at frame ${keyframe.frame} while applying step ${keyframe.stepIndex}.`,
              {
                stepIndex: keyframe.stepIndex,
                detail: result.error,
                hint: `${done} of ${path.keyframes.length} keyframes were written before this.`,
                cause
              }
            );
          }
        }
      }
      const failures = results.filter((result) => !result.ok);
      return { total: path.keyframes.length, applied: results.length - failures.length, results, failures };
    }
    /** Seeks to one frame and writes the whole camera state there. */
    async applyKeyframe(keyframe, options = {}) {
      await seekToFrame(this.page, keyframe.frame, {
        readout: this.selectors.playhead.readout.candidates[0],
        settleMs: this.settleMs
      });
      this.onProgress?.({ kind: "seek", frame: keyframe.frame, stepIndex: keyframe.stepIndex });
      const written = {};
      const skipped = [];
      const details = [];
      for (const name of CAMERA_FIELD_ORDER) {
        const attribute = this.selectors.camera[name];
        if (name === "fieldOfView" && options.writeFieldOfView !== true) {
          skipped.push(name);
          continue;
        }
        if (!await this.isUsable(widgetSelector(attribute))) {
          if (attribute.required) {
            throw new AgentError("DRIVER_FIELD_WRITE_FAILED", `The ${attribute.label} row cannot be edited.`, {
              stepIndex: keyframe.stepIndex,
              detail: `${widgetSelector(attribute)} is ${await this.exists(widgetSelector(attribute)) ? "on the page but not shown" : "not on the page"}.`,
              hint: "Open the Camera Position group in Earth Studio so its fields are visible."
            });
          }
          skipped.push(name);
          continue;
        }
        const value = keyframe.camera[name];
        details.push(
          await writeAttribute(this.page, toTarget(attribute), value, {
            addKeyframe: this.addKeyframes,
            timeoutMs: this.timeoutMs
          })
        );
        written[name] = value;
        this.onProgress?.({ kind: "field", frame: keyframe.frame, stepIndex: keyframe.stepIndex, field: name, value });
      }
      this.onProgress?.({ kind: "keyframe", frame: keyframe.frame, stepIndex: keyframe.stepIndex });
      return { frame: keyframe.frame, stepIndex: keyframe.stepIndex, label: keyframe.label, written, skipped, details, ok: true };
    }
    /** The frame the playhead is on, as the page reports it. */
    async currentFrame() {
      return readFrame(this.page, this.selectors.playhead.readout.candidates[0], this.settleMs);
    }
    async matchOne(field) {
      for (const candidate of field.candidates) {
        if (await this.exists(candidate)) return candidate;
      }
      return null;
    }
    async exists(selector) {
      const handle = await this.page.$(selector);
      return handle !== null && handle !== void 0;
    }
    /** Present, rendered and clickable - not merely in the DOM. */
    async isUsable(selector) {
      if (typeof this.page.evaluate !== "function") return this.exists(selector);
      return this.page.evaluate((target) => {
        const node = document.querySelector(target);
        if (node === null) return false;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(node);
        return style.visibility !== "hidden" && style.display !== "none";
      }, selector);
    }
  };
  function toTarget(attribute) {
    return {
      label: attribute.label,
      attributeType: attribute.attributeType,
      widget: attribute.widget,
      plannedUnit: attribute.plannedUnit
    };
  }

  // src/extension/dom-page.ts
  var DomPage = class _DomPage {
    doc;
    defaultTimeout;
    input;
    constructor(options = {}) {
      this.doc = options.document ?? globalThis.document;
      this.defaultTimeout = options.timeoutMs ?? 1e4;
      this.input = options.input;
    }
    /** The real-input channel, if it answered yes. */
    async realInput() {
      if (this.input === void 0) return void 0;
      try {
        return await this.input.available() ? this.input : void 0;
      } catch {
        return void 0;
      }
    }
    /** Where a mouse would land on an element, after bringing it into view. */
    static point(element) {
      element.scrollIntoView?.({ block: "center", inline: "center" });
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    /** Lets go of anything held for the sake of real input. */
    async release() {
      await this.input?.release().catch(() => void 0);
    }
    /** There is nothing to navigate: the script is already on the page. */
    async goto() {
      return null;
    }
    async $(selector) {
      return this.doc.querySelector(selector);
    }
    async waitForSelector(selector, options = {}) {
      const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
      if (element === null) throw new Error(`Timed out waiting for ${selector}`);
      return element;
    }
    async click(selector, options = {}) {
      const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
      if (element === null) throw new Error(`Timed out waiting for ${selector}`);
      const input = await this.realInput();
      const at = input === void 0 ? null : _DomPage.point(element);
      if (input !== void 0 && at !== null) {
        await input.click(at.x, at.y);
        return;
      }
      dispatchClick(element);
    }
    async hover(selector, options = {}) {
      const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
      if (element === null) throw new Error(`Timed out waiting for ${selector}`);
      for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
        element.dispatchEvent(pointerEvent(type, element));
      }
    }
    async fill(selector, value, options = {}) {
      const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
      if (element === null) throw new Error(`Timed out waiting for ${selector}`);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.focus();
        setNativeValue(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      const editable = element;
      editable.focus();
      selectAll(editable);
      const input = await this.realInput();
      if (input !== void 0) {
        await input.type(value);
        return;
      }
      editable.textContent = value;
      placeCaretAtEnd(editable);
      editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
    async inputValue(selector, options = {}) {
      const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
      if (element === null) throw new Error(`Timed out waiting for ${selector}`);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
      return element.textContent ?? "";
    }
    async press(selector, key, options = {}) {
      const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
      if (element === null) throw new Error(`Timed out waiting for ${selector}`);
      element.focus?.();
      const input = await this.realInput();
      if (input !== void 0) {
        await input.key(key);
        return;
      }
      sendKey(element, key);
    }
    /** Runs a function against this document. There is nothing to serialise. */
    async evaluate(pageFunction, arg) {
      return pageFunction(arg);
    }
    keyboard = {
      press: async (key) => {
        const input = await this.realInput();
        if (input !== void 0) {
          await input.key(key);
          return;
        }
        sendKey(this.doc.activeElement ?? this.doc.body, key);
      },
      type: async (text) => {
        const input = await this.realInput();
        if (input !== void 0) {
          await input.type(text);
          return;
        }
        const target = this.doc.activeElement;
        if (target === null) return;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          setNativeValue(target, text);
          target.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
        const editable = target;
        if (editable.isContentEditable) {
          editable.textContent = text;
          placeCaretAtEnd(editable);
          editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        }
      }
    };
    async wait(selector, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      for (; ; ) {
        const element = this.doc.querySelector(selector);
        if (element !== null) return element;
        if (Date.now() >= deadline) return null;
        await new Promise((done) => setTimeout(done, 50));
      }
    }
  };
  function dispatchClick(element) {
    for (const type of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup"]) {
      element.dispatchEvent(pointerEvent(type, element));
    }
    element.click?.();
  }
  function pointerEvent(type, element) {
    const rect = element.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0
    };
    return type.startsWith("pointer") && typeof PointerEvent === "function" ? new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true }) : new MouseEvent(type, init);
  }
  function sendKey(target, key) {
    const parts = key.split("+");
    const name = parts.pop() ?? key;
    const modifiers = new Set(parts.map((part) => part.toLowerCase()));
    const init = {
      key: name,
      code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: modifiers.has("control") || modifiers.has("ctrl"),
      shiftKey: modifiers.has("shift"),
      altKey: modifiers.has("alt"),
      metaKey: modifiers.has("meta")
    };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  }
  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }
  function selectAll(element) {
    const selection = element.ownerDocument.getSelection();
    if (selection === null) return;
    selection.removeAllRanges();
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection.addRange(range);
  }
  function placeCaretAtEnd(element) {
    const selection = element.ownerDocument.getSelection();
    if (selection === null) return;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // src/extension/language.ts
  var ENGLISH_MARKERS = /\b(fly|go|move|travel|zoom|pan|hold|wait|start|begin|from|to|into|over|at|then|and|second|seconds|sec|minute|minutes|close|level|space|city|country|street|region|state)\b/i;
  function looksEnglish(text) {
    const letters = text.replace(/[^\p{L}]/gu, "");
    if (letters === "") return false;
    const latin = letters.replace(/[^\p{Script=Latin}]/gu, "");
    if (latin.length / letters.length < 0.5) return false;
    return ENGLISH_MARKERS.test(text);
  }
  function translatorApi() {
    return globalThis.Translator;
  }
  function detectorApi() {
    return globalThis.LanguageDetector;
  }
  async function detectLanguage(text, options = {}) {
    if (options.detectLanguage !== void 0) return options.detectLanguage(text);
    const api = detectorApi();
    if (api === void 0) return "und";
    try {
      if (await api.availability() === "unavailable") return "und";
      const detector = await api.create();
      const results = await detector.detect(text);
      return results[0]?.detectedLanguage ?? "und";
    } catch {
      return "und";
    }
  }
  async function toEnglish(text, options = {}) {
    const trimmed = text.trim();
    if (trimmed === "") {
      throw new AgentError("EMPTY_COMMAND", "The command is empty.");
    }
    if (options.assumeEnglish === true) {
      return { english: trimmed, translated: false, via: "assumed" };
    }
    if (looksEnglish(trimmed)) {
      return { english: trimmed, translated: false, via: "already-english" };
    }
    const detected = await detectLanguage(trimmed, options);
    const source = detected === "und" || detected === "en" ? "auto" : detected;
    if (options.translate !== void 0) {
      const english = (await options.translate(trimmed, source)).trim();
      if (english === "") {
        throw new AgentError("EMPTY_COMMAND", "The translation came back empty.", {
          detail: `Input language: ${detected}`
        });
      }
      return { english, detected, translated: true, via: "supplied" };
    }
    const api = translatorApi();
    if (api === void 0 || source === "auto") {
      throw new AgentError("NO_STEPS_PARSED", "This command is not in English and it could not be translated.", {
        detail: api === void 0 ? "This browser has no built-in translator." : `The language of the command could not be identified (detected: ${detected}).`,
        hint: "Write the command in English, or set a translation service in the extension options."
      });
    }
    try {
      if (await api.availability({ sourceLanguage: source, targetLanguage: "en" }) === "unavailable") {
        throw new Error(`translation from ${source} is not available`);
      }
      const translator = await api.create({ sourceLanguage: source, targetLanguage: "en" });
      const english = (await translator.translate(trimmed)).trim();
      translator.destroy?.();
      if (english === "") throw new Error("the translation came back empty");
      return { english, detected, translated: true, via: "chrome-translator" };
    } catch (cause) {
      throw new AgentError("NO_STEPS_PARSED", `The command could not be translated from ${detected}.`, {
        detail: cause instanceof Error ? cause.message : String(cause),
        hint: "Write the command in English, or set a translation service in the extension options.",
        cause
      });
    }
  }

  // src/extension/run-in-page.ts
  async function runCommandInPage(command, options = {}) {
    const notify = options.onProgress ?? (() => {
    });
    notify({ stage: "translating", message: "Reading the command" });
    const translation = await toEnglish(command, options.language ?? {});
    notify({ stage: "planning", message: "Working out the camera path" });
    const parsed = parseCommand(translation.english);
    const settings = applyProjectSettings(options.config ?? {}, parsed.project);
    const config = makeConfig(settings.config);
    const providers = [offlineProvider];
    if (options.online === true) providers.push(createNominatimProvider());
    const geocoder = new Geocoder({ providers, ambiguityRatio: config.ambiguityRatio });
    const { steps, ignored, notes } = parsed;
    const resolved = await resolveSteps(steps, geocoder, config);
    const warnings = [...resolved.warnings, ...settings.warnings, ...noteWarnings(notes)];
    for (const clause of ignored) {
      warnings.push({ code: "CLAUSE_IGNORED", message: `Could not interpret "${clause}"; it was left out.` });
    }
    const path = buildTimeline(resolved.steps, config, translation.english, warnings);
    const page = new DomPage({ input: options.input });
    const driver = new EarthStudioDriver(page, {
      onProgress: (event) => {
        if (event.kind !== "keyframe") return;
        const done = path.keyframes.findIndex((keyframe) => keyframe.frame === event.frame) + 1;
        notify({
          stage: "writing",
          message: `Wrote keyframe ${done} of ${path.keyframes.length} at frame ${event.frame}`,
          fraction: done / path.keyframes.length
        });
      }
    });
    notify({ stage: "checking", message: "Checking the Earth Studio controls" });
    const layout = await driver.verifyLayout();
    if (!layout.ok) {
      throw new AgentError("DRIVER_LAYOUT_MISMATCH", "The Earth Studio page is missing controls the agent needs.", {
        detail: `Missing: ${layout.missing.join(", ")}`,
        hint: "Open a project so the camera attributes are on screen, then try again."
      });
    }
    if (options.dryRun === true) {
      notify({ stage: "done", message: `Planned ${path.keyframes.length} keyframes; nothing was written` });
      return { translation, path, layout, warnings: path.warnings };
    }
    const realInput = options.input === void 0 ? false : await options.input.available().catch(() => false);
    if (!realInput) {
      path.warnings.push({
        code: "NO_REAL_INPUT",
        message: 'Chrome is not letting the extension send real input, so scripted events are all that is left - Earth Studio usually ignores those. Reload the extension, and leave the "started debugging this browser" banner alone while the run is going.'
      });
    }
    notify({ stage: "writing", message: `Writing ${path.keyframes.length} keyframes`, fraction: 0 });
    try {
      const report = await driver.applyPath(path);
      notify({ stage: "done", message: `Wrote ${report.applied} of ${report.total} keyframes`, fraction: 1 });
      return { translation, path, layout, report, warnings: path.warnings };
    } finally {
      await page.release();
    }
  }
  return __toCommonJS(run_in_page_exports);
})();
