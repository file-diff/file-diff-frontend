import { createRoot } from 'react-dom/client'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import '@fontsource/fira-code/latin-400.css'
import '@fontsource/fira-code/latin-500.css'
import '@fontsource/fira-code/latin-600.css'
import '@fontsource/source-code-pro/latin-400.css'
import '@fontsource/source-code-pro/latin-500.css'
import '@fontsource/source-code-pro/latin-600.css'
import '@fontsource/roboto-mono/latin-400.css'
import '@fontsource/roboto-mono/latin-500.css'
import '@fontsource/roboto-mono/latin-600.css'
import '@fontsource/ubuntu-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import '@fontsource/inconsolata/latin-400.css'
import '@fontsource/inconsolata/latin-500.css'
import '@fontsource/inconsolata/latin-600.css'
import { initializeFont } from './utils/fontInit'
import { installApiBearerTokenFetch } from './utils/installApiBearerTokenFetch'
import './index.css'
import App from './App.tsx'

initializeFont()
installApiBearerTokenFetch()

createRoot(document.getElementById('root')!).render(
  <App />
)
