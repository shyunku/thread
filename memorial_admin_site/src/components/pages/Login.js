import { Component } from "react";

import TopBanner from "components/fragments/TopBanner";

import axios from "axios";
import sha256 from "sha256";

class Login extends Component {
  constructor(props) {
    super(props);

    this.state = {
      email_input: "",
      pw_input: "",
    };

    let savedAuthToken = localStorage.getItem("auth_token");
    if (savedAuthToken) {
      window.location.href = "/home";
      axios.defaults.headers.common["Authorization"] = `Bearer ${savedAuthToken}`;
    }
  }

  authenticate = (email = this.state.email_input, pw = this.state.pw_input) => {
    const encrypted_key = sha256(sha256(sha256(email) + pw));
    const data = { auth_id: email, encrypted_password: encrypted_key };
    axios
      .post(`${process.env.REACT_APP_APP_SERVER_ENTRY}/v1/auth/admin-login`, data)
      .then((res) => {
        const resp = res.data;
        console.log(resp);
        const { auth } = resp;
        const { access_token, refresh_token } = auth;

        localStorage.setItem("auth_token", access_token.token);
        window.location.href = "/home";
      })
      .catch((err) => {
        console.error(err);
        alert(err.message ?? "Unknown error");
      });
  };

  goToSecretPage = (e) => {
    window.location.href = "/secret";
    e.preventDefault();
  };

  inputChangeHandler = (e) => {
    this.setState({
      [`${e.target.name}_input`]: e.target.value,
    });
  };

  onPasswordEnterDownHandler = (e) => {
    if (e.keyCode === 13) {
      this.authenticate();
    }
  };

  render() {
    return (
      <div className="page login">
        <TopBanner />
        <div className="body">
          <div className="form-wrapper">
            <div className="title">Sign In</div>
            <div className="description">Manage everything from memorial.</div>
            <div className="form">
              <input
                className="form-input"
                placeholder="Your ID..."
                spellCheck={false}
                onChange={this.inputChangeHandler}
                value={this.state.email_input}
                name="email"
              ></input>
              <input
                className="form-input"
                placeholder="Your password..."
                onKeyDown={this.onPasswordEnterDownHandler}
                onChange={this.inputChangeHandler}
                value={this.state.pw_input}
                name="pw"
                type="password"
              ></input>
              <button className="submit" onContextMenu={this.goToSecretPage} onClick={this.authenticate}>
                Sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default Login;
