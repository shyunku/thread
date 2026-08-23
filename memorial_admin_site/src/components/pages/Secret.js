import { Component } from "react";

import TopBanner from "components/fragments/TopBanner";

import sha256 from 'sha256';

class Secret extends Component {
    constructor(props) {
        super(props);

        this.state = {
            pw_input: "",
            pw2_input: ""
        };
    }

    inputChangeHandler = e => {
        this.setState({
            [`${e.target.name}_input`]: e.target.value
        });
    }

    onPasswordEnterDownHandler = e => {
        if(e.keyCode === 13) {
            this.authenticate();
        }
    }

    render() {
        const {
            pw_input, 
            pw2_input
        } = this.state;

        let verified = pw_input == pw2_input;

        return(
            <div className="page login secret">
                <TopBanner/>
                <div className="body">
                    <div className="form-wrapper">
                        <div className="title">Secret Page</div>
                        <div className="description">How did you get here?!</div>
                        <div className="form">
                            <input className="form-input" placeholder="Your password..."
                                onKeyDown={this.onPasswordEnterDownHandler}
                                onChange={this.inputChangeHandler} value={this.state.pw_input} name="pw" type="password"></input>
                            <input className="form-input" placeholder="Your password once again..."
                                onKeyDown={this.onPasswordEnterDownHandler}
                                onChange={this.inputChangeHandler} value={this.state.pw2_input} name="pw2" type="password"></input>
                            <div className="encrypted">{sha256(this.state.pw_input)}</div>
                            <div className={"verified" + (!verified ? ' not' : '')}>
                                <div className="centered">{verified ? 'Identical' : 'Unidentical'}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default Secret;