import {createRoot} from 'react-dom/client';
import App from './App';
import { GoogleOAuthProvider } from '@react-oauth/google';

createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId="611732788399-2bkhsdo1l25tn0b7mbaa11qfas57924b.apps.googleusercontent.com">
    <App/>
  </GoogleOAuthProvider>
);
