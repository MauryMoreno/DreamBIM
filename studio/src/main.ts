import './styles/tokens.css';
import './styles/app.css';
import './styles/home.css';
import './ribbon/ribbon.css';
import './properties/properties.css';
import './browser/browser.css';
import './workspace/workspace.css';
import './composer/composer.css';
import './library/library.css';
import './collection/collection.css';
import './modes/modes.css';
import './materials/materials.css';
import './costs/costs.css';
import './schedule/schedule.css';
import './docs/docs.css';
import './tour/tour.css';
import { start } from './app/start';
import { initTheme } from './shell/theme';

// The index.html script already painted the first frame with the theme; here the state is hooked up (no flash).
initTheme();

const root = document.getElementById('app');
if (root) void start(root);
