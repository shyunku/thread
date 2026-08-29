import { Component } from "react";
import axios from "axios";
import util from "static/js/util";

class Dashboard extends Component {
  constructor(props) {
    super(props);

    this.state = {
      latest_version: {},
      online_users: {},
      entered_users: {},
      user_count: {},
      workspace_count: {},
      online_workspaces: {},
    };
  }

  componentDidMount = () => {
    this.repeater = setInterval(() => {
      this.forceUpdate();
    }, 100);

    this.fetcher = util.fastInterval(() => {
      this.fetchLatestVersion();
      this.fetchOnlineUsers();
      this.fetchUserCount();
    }, 10000);
  };

  componentWillUnmount = () => {
    clearInterval(this.repeater);
    clearInterval(this.fetcher);
  };

  fetchLatestVersion = () => {
    axios
      .get(`${process.env.REACT_APP_RMS_ENTRY}/default/latest-version`)
      .then((res) => {
        const resp = res.data;
        if (resp.code === 200) {
          this.setState({
            latest_version: {
              version: resp.data.version,
              updated_timestamp: Date.now(),
            },
          });
        } else {
          switch (resp.code) {
            case 313:
              this.setState({
                latest_version: {
                  version: "0.0.0",
                  updated_timestamp: null,
                },
              });
              break;
            default:
              console.error(resp.code);
          }
        }
      })
      .catch((err) => {
        console.error(err);
      });
  };

  fetchOnlineUsers = () => {
    axios
      .get(`${process.env.REACT_APP_APP_SERVER_ENTRY}/v1/admin/online-user-count`)
      .then((res) => {
        const resp = res.data;
        this.setState({
          online_users: {
            value: resp,
            updated_timestamp: Date.now(),
          },
        });
      })
      .catch((err) => {
        console.error(err);
      });
  };

  fetchUserCount = () => {
    axios
      .get(`${process.env.REACT_APP_APP_SERVER_ENTRY}/v1/admin/user-count`)
      .then((res) => {
        const resp = res.data;
        this.setState({
          user_count: {
            value: resp,
            updated_timestamp: Date.now(),
          },
        });
      })
      .catch((err) => {
        console.error(err);
      });
  };

  render() {
    const { latest_version, online_users, entered_users, user_count, workspace_count, online_workspaces } = this.state;

    return (
      <div className="dashboard-cards">
        <div className="card box" onClick={(e) => this.menuSelectHandler("version")}>
          <div className="content">
            <div className="high">{latest_version?.version}</div>
          </div>
          <div className="title">Currently Latest Version</div>
          <div className="last-update-time">{util.toRelativeTime(latest_version?.updated_timestamp)}</div>
        </div>
        <div className="card box" onClick={(e) => this.menuSelectHandler("users")}>
          <div className="content">
            <div className="high">{online_users?.value ?? "?"}</div>
            <div className="slash">/</div>
            <div className="base">{user_count?.value ?? "?"}</div>
          </div>
          <div className="title">Online Users / Total Users</div>
          <div className="last-update-time">{util.toRelativeTime(online_users?.updated_timestamp)}</div>
        </div>
      </div>
    );
  }
}

export default Dashboard;
