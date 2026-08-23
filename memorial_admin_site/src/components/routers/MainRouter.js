import React, {Component} from 'react';
import {Route, Routes, BrowserRouter} from 'react-router-dom';

import Login from 'components/pages/Login';
import Secret from 'components/pages/Secret';
import Home from 'components/pages/Home';

class PageRouter extends Component {
    render() {
        return (
            <BrowserRouter>
                <Routes>
                    <Route exact path="/" element={<Login/>}/>
                    <Route path="/signin" element={<Login/>}/>
                    <Route path="/secret" element={<Secret/>}/>
                    <Route path="/home" element={<Home/>}/>
                </Routes>
            </BrowserRouter>
        );
    }
}

export default PageRouter;