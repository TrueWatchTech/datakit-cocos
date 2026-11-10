import { platformGlobal } from '../core/platform-runtime.js';
import { installJsbErrorSource, type FTJsbErrorGlobal } from './jsb-errors.js';

// The native build hook prepends this bundle to main.js before engine adapters.
installJsbErrorSource(platformGlobal() as FTJsbErrorGlobal);
