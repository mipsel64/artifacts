import { hydrateRoot } from 'react-dom/client';
import { App } from './App';
import type { PageData } from './pages';

const root = document.getElementById('root');
const pageData = document.getElementById('page-data');
if (!root || !pageData?.textContent) throw new Error('Page data is not available');
const data = JSON.parse(pageData.textContent) as PageData;
hydrateRoot(root, <App {...data} />);
