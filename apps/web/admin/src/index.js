import React from 'react';
import ReactDOM from 'react-dom';
import reportWebVitals from './reportWebVitals';
import PageRouter from 'components/routers/MainRouter';

import 'static/scss/reset.scss';
import 'static/scss/default.scss';
import 'static/scss/index.scss';

ReactDOM.render(
  <PageRouter />,
  document.getElementById('root')
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
