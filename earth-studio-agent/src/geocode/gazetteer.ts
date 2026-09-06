/**
 * Built-in gazetteer.
 *
 * The agent must produce the same camera path on every machine and must work
 * with no network, so well-known places are resolved from this table first and
 * only fall through to an online provider when nothing here matches.
 *
 * `weight` is a relative likelihood that a bare mention of the name means this
 * place. It is seeded from metropolitan population for populated places and set
 * by hand for landmarks and for the handful of names that genuinely collide
 * (Georgia, Washington, Cambridge, San Jose, Springfield, Paris, Naples).
 */
import type { PlaceKind } from '../types.ts';

export interface GazetteerEntry {
  name: string;
  latitude: number;
  longitude: number;
  kind: PlaceKind;
  weight: number;
  context: string;
  aliases: string[];
}

type Row = [string, number, number, PlaceKind, number, string, string[]?];

const ROWS: Row[] = [
  // --- countries -----------------------------------------------------------
  ['Japan', 36.2048, 138.2529, 'country', 125_000_000, 'country in East Asia'],
  ['United States', 39.8283, -98.5795, 'country', 331_000_000, 'country in North America', ['usa', 'us', 'u.s.', 'u.s.a.', 'america', 'united states of america', 'the states']],
  ['France', 46.2276, 2.2137, 'country', 67_000_000, 'country in Western Europe'],
  ['Italy', 41.8719, 12.5674, 'country', 59_000_000, 'country in Southern Europe'],
  ['Germany', 51.1657, 10.4515, 'country', 83_000_000, 'country in Central Europe'],
  ['United Kingdom', 55.3781, -3.436, 'country', 67_000_000, 'country in Western Europe', ['uk', 'u.k.', 'britain', 'great britain', 'england']],
  ['Spain', 40.4637, -3.7492, 'country', 47_000_000, 'country in Southern Europe'],
  ['China', 35.8617, 104.1954, 'country', 1_412_000_000, 'country in East Asia'],
  ['India', 20.5937, 78.9629, 'country', 1_380_000_000, 'country in South Asia'],
  ['Brazil', -14.235, -51.9253, 'country', 213_000_000, 'country in South America'],
  ['Canada', 56.1304, -106.3468, 'country', 38_000_000, 'country in North America'],
  ['Australia', -25.2744, 133.7751, 'country', 25_700_000, 'country and continent'],
  ['Russia', 61.524, 105.3188, 'country', 144_000_000, 'country in Eastern Europe and North Asia'],
  ['Mexico', 23.6345, -102.5528, 'country', 128_000_000, 'country in North America'],
  ['Egypt', 26.8206, 30.8025, 'country', 102_000_000, 'country in North Africa'],
  ['Kenya', -0.0236, 37.9062, 'country', 53_000_000, 'country in East Africa'],
  ['South Africa', -30.5595, 22.9375, 'country', 59_000_000, 'country in Southern Africa'],
  ['Nigeria', 9.082, 8.6753, 'country', 206_000_000, 'country in West Africa'],
  ['Argentina', -38.4161, -63.6167, 'country', 45_000_000, 'country in South America'],
  ['Peru', -9.19, -75.0152, 'country', 33_000_000, 'country in South America'],
  ['Chile', -35.6751, -71.543, 'country', 19_000_000, 'country in South America'],
  ['Colombia', 4.5709, -74.2973, 'country', 50_000_000, 'country in South America'],
  ['Cuba', 21.5218, -77.7812, 'country', 11_000_000, 'island country in the Caribbean'],
  ['Norway', 60.472, 8.4689, 'country', 5_400_000, 'country in Northern Europe'],
  ['Sweden', 60.1282, 18.6435, 'country', 10_400_000, 'country in Northern Europe'],
  ['Finland', 61.9241, 25.7482, 'country', 5_500_000, 'country in Northern Europe'],
  ['Denmark', 56.2639, 9.5018, 'country', 5_800_000, 'country in Northern Europe'],
  ['Iceland', 64.9631, -19.0208, 'country', 370_000, 'island country in the North Atlantic'],
  ['Switzerland', 46.8182, 8.2275, 'country', 8_600_000, 'country in Central Europe'],
  ['Austria', 47.5162, 14.5501, 'country', 8_900_000, 'country in Central Europe'],
  ['Netherlands', 52.1326, 5.2913, 'country', 17_400_000, 'country in Western Europe', ['holland']],
  ['Belgium', 50.5039, 4.4699, 'country', 11_500_000, 'country in Western Europe'],
  ['Greece', 39.0742, 21.8243, 'country', 10_700_000, 'country in Southern Europe'],
  ['Turkey', 38.9637, 35.2433, 'country', 84_000_000, 'country in Anatolia', ['turkiye']],
  ['Georgia', 42.3154, 43.3569, 'country', 11_000_000, 'country in the Caucasus'],
  ['Indonesia', -0.7893, 113.9213, 'country', 273_000_000, 'country in Southeast Asia'],
  ['Thailand', 15.87, 100.9925, 'country', 70_000_000, 'country in Southeast Asia'],
  ['Vietnam', 14.0583, 108.2772, 'country', 97_000_000, 'country in Southeast Asia'],
  ['South Korea', 35.9078, 127.7669, 'country', 51_000_000, 'country in East Asia', ['korea']],
  ['New Zealand', -40.9006, 174.886, 'country', 5_100_000, 'island country in Oceania'],
  ['Saudi Arabia', 23.8859, 45.0792, 'country', 34_000_000, 'country in the Arabian Peninsula'],
  ['United Arab Emirates', 23.4241, 53.8478, 'country', 9_900_000, 'country in the Arabian Peninsula', ['uae']],
  ['Morocco', 31.7917, -7.0926, 'country', 36_000_000, 'country in North Africa'],
  ['Portugal', 39.3999, -8.2245, 'country', 10_300_000, 'country in Southern Europe'],
  ['Ireland', 53.1424, -7.6921, 'country', 5_000_000, 'island country in Western Europe'],
  ['Poland', 51.9194, 19.1451, 'country', 38_000_000, 'country in Central Europe'],
  ['Singapore', 1.3521, 103.8198, 'country', 5_700_000, 'city-state in Southeast Asia'],
  ['Nepal', 28.3949, 84.124, 'country', 29_000_000, 'country in South Asia'],
  ['Iran', 32.4279, 53.688, 'country', 84_000_000, 'country in Western Asia'],
  ['Israel', 31.0461, 34.8516, 'country', 9_200_000, 'country in Western Asia'],
  ['Maldives', 3.2028, 73.2207, 'country', 540_000, 'island country in the Indian Ocean'],
  ['Trinidad and Tobago', 10.6918, -61.2225, 'country', 1_400_000, 'island country in the Caribbean'],
  ['Bosnia and Herzegovina', 43.9159, 17.6791, 'country', 3_300_000, 'country in the Balkans'],

  // --- regions and states --------------------------------------------------
  ['Georgia', 32.1656, -82.9001, 'region', 10_700_000, 'state in the United States', ['georgia usa', 'state of georgia']],
  ['California', 36.7783, -119.4179, 'region', 39_500_000, 'state in the United States'],
  ['Texas', 31.9686, -99.9018, 'region', 29_100_000, 'state in the United States'],
  ['Florida', 27.6648, -81.5158, 'region', 21_500_000, 'state in the United States'],
  ['New York', 43.0, -75.0, 'region', 19_800_000, 'state in the United States', ['new york state']],
  ['Alaska', 64.2008, -149.4937, 'region', 730_000, 'state in the United States'],
  ['Hawaii', 19.8968, -155.5828, 'region', 1_450_000, 'state in the United States'],
  ['Washington', 47.7511, -120.7401, 'region', 7_700_000, 'state in the United States', ['washington state']],
  ['Tuscany', 43.7711, 11.2486, 'region', 3_700_000, 'region in Italy'],
  ['Bavaria', 48.7904, 11.4979, 'region', 13_100_000, 'state in Germany'],
  ['Provence', 43.9352, 6.0679, 'region', 5_100_000, 'region in France'],
  ['Scotland', 56.4907, -4.2026, 'region', 5_500_000, 'country within the United Kingdom'],
  ['Bali', -8.3405, 115.092, 'region', 4_300_000, 'island province of Indonesia'],
  ['Patagonia', -45.0, -70.0, 'region', 2_000_000, 'region in Argentina and Chile'],
  ['Siberia', 60.0, 105.0, 'region', 33_000_000, 'region of Russia'],

  // --- cities --------------------------------------------------------------
  ['Tokyo', 35.6762, 139.6503, 'city', 37_000_000, 'capital of Japan'],
  ['Kyoto', 35.0116, 135.7681, 'city', 1_500_000, 'city in Japan'],
  ['Osaka', 34.6937, 135.5023, 'city', 19_000_000, 'city in Japan'],
  ['Sapporo', 43.0618, 141.3545, 'city', 1_950_000, 'city in Japan'],
  ['Paris', 48.8566, 2.3522, 'city', 11_000_000, 'capital of France'],
  ['Paris, Texas', 33.6609, -95.5555, 'city', 25_000, 'city in Texas, United States', ['paris texas', 'paris']],
  ['London', 51.5074, -0.1278, 'city', 9_500_000, 'capital of the United Kingdom'],
  ['Edinburgh', 55.9533, -3.1883, 'city', 530_000, 'capital of Scotland'],
  ['Cambridge', 52.2053, 0.1218, 'city', 145_000, 'city in England'],
  ['Cambridge, Massachusetts', 42.3736, -71.1097, 'city', 118_000, 'city in Massachusetts, United States', ['cambridge massachusetts', 'cambridge ma', 'cambridge']],
  ['New York City', 40.7128, -74.006, 'city', 20_000_000, 'city in New York, United States', ['nyc', 'new york city', 'new york']],
  ['Los Angeles', 34.0522, -118.2437, 'city', 13_000_000, 'city in California, United States', ['la', 'l.a.']],
  ['San Francisco', 37.7749, -122.4194, 'city', 4_700_000, 'city in California, United States', ['sf']],
  ['San Jose', 37.3382, -121.8863, 'city', 2_000_000, 'city in California, United States', ['san jose california']],
  ['San Jose, Costa Rica', 9.9281, -84.0907, 'city', 1_600_000, 'capital of Costa Rica', ['san jose costa rica', 'san jose']],
  ['Chicago', 41.8781, -87.6298, 'city', 9_500_000, 'city in Illinois, United States'],
  ['Seattle', 47.6062, -122.3321, 'city', 4_000_000, 'city in Washington, United States'],
  ['Miami', 25.7617, -80.1918, 'city', 6_100_000, 'city in Florida, United States'],
  ['Boston', 42.3601, -71.0589, 'city', 4_900_000, 'city in Massachusetts, United States'],
  ['Washington, D.C.', 38.9072, -77.0369, 'city', 9_000_000, 'capital of the United States', ['washington dc', 'dc', 'washington d.c.', 'washington']],
  ['Las Vegas', 36.1699, -115.1398, 'city', 2_300_000, 'city in Nevada, United States'],
  ['Denver', 39.7392, -104.9903, 'city', 2_960_000, 'city in Colorado, United States'],
  ['New Orleans', 29.9511, -90.0715, 'city', 1_270_000, 'city in Louisiana, United States'],
  ['St. Louis', 38.627, -90.1994, 'city', 2_800_000, 'city in Missouri, United States', ['st louis', 'saint louis']],
  ['Philadelphia', 39.9526, -75.1652, 'city', 6_200_000, 'city in Pennsylvania, United States'],
  ['Atlanta', 33.749, -84.388, 'city', 6_100_000, 'capital of Georgia, United States'],
  ['Dallas', 32.7767, -96.797, 'city', 7_600_000, 'city in Texas, United States'],
  ['Houston', 29.7604, -95.3698, 'city', 7_100_000, 'city in Texas, United States'],
  ['Phoenix', 33.4484, -112.074, 'city', 4_900_000, 'capital of Arizona, United States'],
  ['San Diego', 32.7157, -117.1611, 'city', 3_300_000, 'city in California, United States'],
  ['Portland', 45.5152, -122.6784, 'city', 2_500_000, 'city in Oregon, United States'],
  ['Austin', 30.2672, -97.7431, 'city', 2_300_000, 'capital of Texas, United States'],
  ['Nashville', 36.1627, -86.7816, 'city', 2_000_000, 'capital of Tennessee, United States'],
  ['Springfield, Illinois', 39.7817, -89.6501, 'city', 115_000, 'capital of Illinois, United States', ['springfield illinois', 'springfield']],
  ['Springfield, Missouri', 37.209, -93.2923, 'city', 170_000, 'city in Missouri, United States', ['springfield missouri', 'springfield']],
  ['Naples', 40.8518, 14.2681, 'city', 3_100_000, 'city in Italy'],
  ['Naples, Florida', 26.142, -81.7948, 'city', 380_000, 'city in Florida, United States', ['naples florida', 'naples']],
  ['Rome', 41.9028, 12.4964, 'city', 4_300_000, 'capital of Italy'],
  ['Venice', 45.4408, 12.3155, 'city', 260_000, 'city in Italy'],
  ['Florence', 43.7696, 11.2558, 'city', 700_000, 'city in Italy'],
  ['Milan', 45.4642, 9.19, 'city', 3_200_000, 'city in Italy'],
  ['Barcelona', 41.3874, 2.1686, 'city', 5_500_000, 'city in Spain'],
  ['Madrid', 40.4168, -3.7038, 'city', 6_700_000, 'capital of Spain'],
  ['Berlin', 52.52, 13.405, 'city', 3_700_000, 'capital of Germany'],
  ['Munich', 48.1351, 11.582, 'city', 1_500_000, 'city in Germany'],
  ['Amsterdam', 52.3676, 4.9041, 'city', 1_150_000, 'capital of the Netherlands'],
  ['Prague', 50.0755, 14.4378, 'city', 1_300_000, 'capital of Czechia'],
  ['Vienna', 48.2082, 16.3738, 'city', 1_900_000, 'capital of Austria'],
  ['Istanbul', 41.0082, 28.9784, 'city', 15_500_000, 'city in Turkey'],
  ['Athens', 37.9838, 23.7275, 'city', 3_150_000, 'capital of Greece'],
  ['Athens, Georgia', 33.9519, -83.3576, 'city', 128_000, 'city in Georgia, United States', ['athens georgia', 'athens']],
  ['Cairo', 30.0444, 31.2357, 'city', 21_000_000, 'capital of Egypt'],
  ['Dubai', 25.2048, 55.2708, 'city', 3_500_000, 'city in the United Arab Emirates'],
  ['Mumbai', 19.076, 72.8777, 'city', 20_000_000, 'city in India', ['bombay']],
  ['Delhi', 28.6139, 77.209, 'city', 32_000_000, 'capital territory of India', ['new delhi']],
  ['Bangkok', 13.7563, 100.5018, 'city', 10_500_000, 'capital of Thailand'],
  ['Hong Kong', 22.3193, 114.1694, 'city', 7_500_000, 'special administrative region of China'],
  ['Shanghai', 31.2304, 121.4737, 'city', 28_000_000, 'city in China'],
  ['Beijing', 39.9042, 116.4074, 'city', 21_500_000, 'capital of China'],
  ['Seoul', 37.5665, 126.978, 'city', 25_000_000, 'capital of South Korea'],
  ['Sydney', -33.8688, 151.2093, 'city', 5_300_000, 'city in Australia'],
  ['Melbourne', -37.8136, 144.9631, 'city', 5_000_000, 'city in Australia'],
  ['Auckland', -36.8485, 174.7633, 'city', 1_650_000, 'city in New Zealand'],
  ['Rio de Janeiro', -22.9068, -43.1729, 'city', 13_500_000, 'city in Brazil', ['rio']],
  ['Sao Paulo', -23.5505, -46.6333, 'city', 22_000_000, 'city in Brazil', ['são paulo']],
  ['Buenos Aires', -34.6037, -58.3816, 'city', 15_000_000, 'capital of Argentina'],
  ['Lima', -12.0464, -77.0428, 'city', 10_700_000, 'capital of Peru'],
  ['Mexico City', 19.4326, -99.1332, 'city', 21_800_000, 'capital of Mexico'],
  ['Toronto', 43.6532, -79.3832, 'city', 6_200_000, 'city in Canada'],
  ['Vancouver', 49.2827, -123.1207, 'city', 2_600_000, 'city in Canada'],
  ['Montreal', 45.5017, -73.5673, 'city', 4_300_000, 'city in Canada'],
  ['Moscow', 55.7558, 37.6173, 'city', 12_500_000, 'capital of Russia'],
  ['Reykjavik', 64.1466, -21.9426, 'city', 230_000, 'capital of Iceland'],
  ['Oslo', 59.9139, 10.7522, 'city', 1_000_000, 'capital of Norway'],
  ['Stockholm', 59.3293, 18.0686, 'city', 2_400_000, 'capital of Sweden'],
  ['Copenhagen', 55.6761, 12.5683, 'city', 1_350_000, 'capital of Denmark'],
  ['Zurich', 47.3769, 8.5417, 'city', 1_400_000, 'city in Switzerland'],
  ['Geneva', 46.2044, 6.1432, 'city', 600_000, 'city in Switzerland'],
  ['Lisbon', 38.7223, -9.1393, 'city', 2_900_000, 'capital of Portugal'],
  ['Dublin', 53.3498, -6.2603, 'city', 1_400_000, 'capital of Ireland'],
  ['Cape Town', -33.9249, 18.4241, 'city', 4_600_000, 'city in South Africa'],
  ['Nairobi', -1.2921, 36.8219, 'city', 4_400_000, 'capital of Kenya'],
  ['Marrakesh', 31.6295, -7.9811, 'city', 1_000_000, 'city in Morocco', ['marrakech']],
  ['Jerusalem', 31.7683, 35.2137, 'city', 950_000, 'city in Israel'],
  ['Kathmandu', 27.7172, 85.324, 'city', 1_500_000, 'capital of Nepal'],
  ['Victoria', 48.4284, -123.3656, 'city', 400_000, 'capital of British Columbia, Canada'],

  // --- landmarks -----------------------------------------------------------
  ['Mount Fuji', 35.3606, 138.7274, 'landmark', 300_000, 'volcano in Honshu, Japan', ['fuji', 'mt fuji', 'fujisan']],
  ['Eiffel Tower', 48.8584, 2.2945, 'landmark', 300_000, 'tower in Paris, France'],
  ['Louvre', 48.8606, 2.3376, 'landmark', 300_000, 'museum in Paris, France', ['the louvre', 'louvre museum']],
  ['Statue of Liberty', 40.6892, -74.0445, 'landmark', 300_000, 'monument in New York Harbor'],
  ['Empire State Building', 40.7484, -73.9857, 'landmark', 300_000, 'skyscraper in New York City'],
  ['Times Square', 40.758, -73.9855, 'landmark', 300_000, 'junction in New York City'],
  ['Central Park', 40.7829, -73.9654, 'landmark', 300_000, 'park in New York City'],
  ['Golden Gate Bridge', 37.8199, -122.4783, 'landmark', 300_000, 'bridge in San Francisco'],
  ['Hollywood Sign', 34.1341, -118.3215, 'landmark', 300_000, 'landmark in Los Angeles'],
  ['Grand Canyon', 36.1069, -112.1129, 'landmark', 300_000, 'canyon in Arizona, United States'],
  ['Monument Valley', 36.998, -110.0985, 'landmark', 300_000, 'valley on the Arizona-Utah border'],
  ['Antelope Canyon', 36.8619, -111.3743, 'landmark', 300_000, 'slot canyon in Arizona, United States'],
  ['Death Valley', 36.5054, -117.0794, 'landmark', 300_000, 'desert valley in California, United States'],
  ['Yosemite', 37.8651, -119.5383, 'landmark', 300_000, 'national park in California, United States', ['yosemite national park']],
  ['Yellowstone', 44.428, -110.5885, 'landmark', 300_000, 'national park in Wyoming, United States', ['yellowstone national park']],
  ['Mount Rushmore', 43.8791, -103.4591, 'landmark', 300_000, 'memorial in South Dakota, United States'],
  ['Niagara Falls', 43.0962, -79.0377, 'landmark', 300_000, 'waterfall on the Canada-United States border'],
  ['Banff', 51.4968, -115.9281, 'landmark', 300_000, 'national park in Alberta, Canada'],
  ['Great Wall of China', 40.4319, 116.5704, 'landmark', 300_000, 'fortification in China', ['great wall']],
  ['Taj Mahal', 27.1751, 78.0421, 'landmark', 300_000, 'mausoleum in Agra, India'],
  ['Mount Everest', 27.9881, 86.925, 'landmark', 300_000, 'mountain on the Nepal-China border', ['everest']],
  ['Angkor Wat', 13.4125, 103.867, 'landmark', 300_000, 'temple complex in Cambodia'],
  ['Ha Long Bay', 20.9101, 107.1839, 'landmark', 300_000, 'bay in Vietnam', ['halong bay']],
  ['Petronas Towers', 3.1578, 101.7117, 'landmark', 300_000, 'towers in Kuala Lumpur, Malaysia'],
  ['Marina Bay Sands', 1.2834, 103.8607, 'landmark', 300_000, 'resort in Singapore'],
  ['Fushimi Inari', 34.9671, 135.7727, 'landmark', 300_000, 'shrine in Kyoto, Japan'],
  ['Shibuya Crossing', 35.6595, 139.7005, 'landmark', 300_000, 'crossing in Tokyo, Japan', ['shibuya']],
  ['Colosseum', 41.8902, 12.4922, 'landmark', 300_000, 'amphitheatre in Rome, Italy'],
  ['Vatican City', 41.9029, 12.4534, 'landmark', 300_000, 'city-state within Rome', ['the vatican', 'vatican']],
  ['Sagrada Familia', 41.4036, 2.1744, 'landmark', 300_000, 'basilica in Barcelona, Spain'],
  ['Acropolis', 37.9715, 23.7267, 'landmark', 300_000, 'citadel in Athens, Greece'],
  ['Santorini', 36.3932, 25.4615, 'landmark', 300_000, 'island in Greece'],
  ['Hagia Sophia', 41.0086, 28.9802, 'landmark', 300_000, 'mosque and museum in Istanbul, Turkey'],
  ['Stonehenge', 51.1789, -1.8262, 'landmark', 300_000, 'monument in Wiltshire, England'],
  ['Big Ben', 51.5007, -0.1246, 'landmark', 300_000, 'clock tower in London, England'],
  ['Tower Bridge', 51.5055, -0.0754, 'landmark', 300_000, 'bridge in London, England'],
  ['Buckingham Palace', 51.5014, -0.1419, 'landmark', 300_000, 'palace in London, England'],
  ['Cliffs of Moher', 52.9715, -9.4309, 'landmark', 300_000, 'cliffs in County Clare, Ireland'],
  ['Giants Causeway', 55.2408, -6.5116, 'landmark', 300_000, 'rock formation in Northern Ireland', ["giant's causeway"]],
  ['Mont Saint-Michel', 48.6361, -1.5115, 'landmark', 300_000, 'island abbey in Normandy, France', ['mont saint michel']],
  ['Neuschwanstein Castle', 47.5576, 10.7498, 'landmark', 300_000, 'castle in Bavaria, Germany', ['neuschwanstein']],
  ['Brandenburg Gate', 52.5163, 13.3777, 'landmark', 300_000, 'monument in Berlin, Germany'],
  ['Matterhorn', 45.9763, 7.6586, 'landmark', 300_000, 'mountain on the Swiss-Italian border'],
  ['Cinque Terre', 44.1461, 9.6439, 'landmark', 300_000, 'coastline in Liguria, Italy'],
  ['Amalfi Coast', 40.634, 14.6027, 'landmark', 300_000, 'coastline in Campania, Italy'],
  ['Red Square', 55.7539, 37.6208, 'landmark', 300_000, 'square in Moscow, Russia'],
  ['Blue Lagoon', 63.8804, -22.4495, 'landmark', 300_000, 'geothermal spa in Iceland'],
  ['Pyramids of Giza', 29.9792, 31.1342, 'landmark', 300_000, 'pyramids in Giza, Egypt', ['giza', 'great pyramid', 'the pyramids', 'giza pyramids']],
  ['Petra', 30.3285, 35.4444, 'landmark', 300_000, 'archaeological site in Jordan'],
  ['Dead Sea', 31.559, 35.4732, 'landmark', 300_000, 'salt lake bordering Jordan and Israel'],
  ['Sahara Desert', 23.4162, 25.6628, 'landmark', 300_000, 'desert in North Africa', ['sahara']],
  ['Mount Kilimanjaro', -3.0674, 37.3556, 'landmark', 300_000, 'mountain in Tanzania', ['kilimanjaro']],
  ['Serengeti', -2.3333, 34.8333, 'landmark', 300_000, 'national park in Tanzania'],
  ['Victoria Falls', -17.9243, 25.8572, 'landmark', 300_000, 'waterfall on the Zambia-Zimbabwe border'],
  ['Table Mountain', -33.9628, 18.4098, 'landmark', 300_000, 'mountain in Cape Town, South Africa'],
  ['Machu Picchu', -13.1631, -72.545, 'landmark', 300_000, 'Inca citadel in Peru'],
  ['Christ the Redeemer', -22.9519, -43.2105, 'landmark', 300_000, 'statue in Rio de Janeiro, Brazil'],
  ['Iguazu Falls', -25.6953, -54.4367, 'landmark', 300_000, 'waterfalls on the Argentina-Brazil border', ['iguacu falls']],
  ['Amazon Rainforest', -3.4653, -62.2159, 'landmark', 300_000, 'rainforest in South America', ['the amazon', 'amazon']],
  ['Chichen Itza', 20.6843, -88.5678, 'landmark', 300_000, 'Maya city in Yucatan, Mexico'],
  ['Tulum', 20.2114, -87.4654, 'landmark', 300_000, 'ruins and town in Quintana Roo, Mexico'],
  ['Uluru', -25.3444, 131.0369, 'landmark', 300_000, 'rock formation in the Northern Territory, Australia', ['ayers rock']],
  ['Sydney Opera House', -33.8568, 151.2153, 'landmark', 300_000, 'performing arts centre in Sydney, Australia'],
  ['Milford Sound', -44.6414, 167.8974, 'landmark', 300_000, 'fjord in New Zealand'],
  ['Bora Bora', -16.5004, -151.7415, 'landmark', 300_000, 'island in French Polynesia'],
  ['Burj Khalifa', 25.1972, 55.2744, 'landmark', 300_000, 'skyscraper in Dubai, United Arab Emirates'],
];

export const GAZETTEER: GazetteerEntry[] = ROWS.map(([name, latitude, longitude, kind, weight, context, aliases]) => ({
  name,
  latitude,
  longitude,
  kind,
  weight,
  context,
  aliases: aliases ?? [],
}));

/** Lowercase, accent-free, punctuation-free form used for lookups. */
export function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** name -> entries, built once. A name can map to several entries (Georgia). */
const INDEX = new Map<string, GazetteerEntry[]>();
for (const entry of GAZETTEER) {
  for (const key of [entry.name, ...entry.aliases]) {
    const normalised = normaliseName(key);
    const bucket = INDEX.get(normalised);
    if (bucket) bucket.push(entry);
    else INDEX.set(normalised, [entry]);
  }
}

export function lookupExact(query: string): GazetteerEntry[] {
  return INDEX.get(normaliseName(query)) ?? [];
}

/**
 * Whole-word fallback for near-misses like "the eiffel tower".
 *
 * Matching is on token sequences, not raw substrings: a plain `includes` lets a
 * short alias such as "la" match inside an unrelated word ("...nowhere land"),
 * which would resolve nonsense to a real city instead of failing honestly.
 */
export function lookupFuzzy(query: string): GazetteerEntry[] {
  const needle = normaliseName(query);
  if (needle.length < 3) return [];
  const needleTokens = needle.split(' ');
  const hits: GazetteerEntry[] = [];
  for (const [key, entries] of INDEX) {
    if (key === needle) continue;
    const keyTokens = key.split(' ');
    if (containsSequence(needleTokens, keyTokens) || containsSequence(keyTokens, needleTokens)) {
      hits.push(...entries);
    }
  }
  return [...new Set(hits)];
}

/** True when `needle` appears as a run of consecutive tokens inside `haystack`. */
function containsSequence(haystack: string[], needle: string[]): boolean {
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

/** Every distinct place name in the table, used by the CLI's --list-places. */
export function knownNames(): string[] {
  return [...new Set(GAZETTEER.map((entry) => entry.name))].sort();
}

/**
 * Place names whose own punctuation would otherwise be read as a clause break:
 * "Washington, D.C." and "Trinidad and Tobago" must survive the parser's split
 * on commas and on "and". Longest first, so the most specific name wins.
 */
export function multiWordPlaceNames(): string[] {
  const names = new Set<string>();
  for (const entry of GAZETTEER) {
    for (const key of [entry.name, ...entry.aliases]) {
      if (key.includes(',') || / and /i.test(key)) names.add(key);
    }
  }
  return [...names].sort((a, b) => b.length - a.length);
}
