// The claude theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in claude.settings.json and the generated claude.settings.ts;
// change them with `astryx experimental theme editor set claude ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {claudeSettings} from './claude.settings';

export const claudeTheme = defineTheme({
  extends: claudeSettings,
  name: 'claude',
  components: {
    'text-input': { base: { borderColor: 'light-dark(#8a8880, #7a7872)' } },
    'text-area': { base: { borderColor: 'light-dark(#8a8880, #7a7872)' } },
    'number-input': { base: { borderColor: 'light-dark(#8a8880, #7a7872)' } },
    'date-input': { base: { borderColor: 'light-dark(#8a8880, #7a7872)' } },
    'time-input': { base: { borderColor: 'light-dark(#8a8880, #7a7872)' } },
    'date-time-input': { base: { borderColor: 'light-dark(#8a8880, #7a7872)' } },
    'date-range-input': { base: { borderColor: 'light-dark(#8a8880, #7a7872)' } },
    'typeahead': { base: { borderColor: 'light-dark(#8a8880, #7a7872)' } },
    'tokenizer': { base: { borderColor: 'light-dark(#8a8880, #7a7872)' } },
  },
});
