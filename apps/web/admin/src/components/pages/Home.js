import { Component } from "react";

import TopBanner from "components/fragments/TopBanner";
import Dashboard from "components/fragments/Dashboard";
import Version from "components/fragments/Version";
import axios from "axios";

class Home extends Component {
  constructor(props) {
    super(props);

    this.menus = ["dashboard", "version", "logout"];
    this.defaultMenu = "dashboard";

    this.state = {
      selected_menu: this.defaultMenu,
    };

    let savedAuthToken = localStorage.getItem("auth_token");
    if (savedAuthToken) {
      // token test
      axios.defaults.headers.common["Authorization"] = `Bearer ${savedAuthToken}`;
      (async () => {
        try {
          await axios.post(`${process.env.REACT_APP_APP_SERVER_ENTRY}/v1/token/test`, {});
        } catch (err) {
          console.log(err);
          const status = err?.response?.status;
          if (status === 401) {
            // token expired
            localStorage.removeItem("auth_token");
          }
        }
      })();
    } else {
      window.location.href = "/signin";
    }
  }

  menuSelectHandler = (menu) => {
    if (menu === "logout") {
      localStorage.removeItem("auth_token");
      window.location.href = "/signin";
    }
    this.setState({
      selected_menu: menu,
    });
  };

  render() {
    const { selected_menu } = this.state;

    return (
      <div className="page home">
        <TopBanner />
        <div className="body">
          <div className="sidebar">
            {this.menus.map((menu) => {
              let capitalizedMenu = menu[0].toUpperCase() + menu.substring(1);
              return (
                <div
                  className={"menu" + (menu === selected_menu ? " selected" : "")}
                  key={menu}
                  onClick={(e) => this.menuSelectHandler(menu)}
                >
                  {capitalizedMenu}
                </div>
              );
            })}
          </div>
          <div className={"content " + selected_menu}>
            {{
              dashboard: <Dashboard />,
              version: <Version />,
            }[selected_menu] || <></>}
          </div>
        </div>
      </div>
    );
  }
}

export default Home;
