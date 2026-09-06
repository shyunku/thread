import { Component } from "react";

class TopBanner extends Component {
  constructor(props) {
    super(props);
  }

  goHome = () => {
    window.location.href = "/";
  };

  render() {
    return (
      <div className="top-banner">
        <div className="logo" onClick={this.goHome}>
          <img src={process.env.PUBLIC_URL + "/logo192.png"} alt="" width="28" height="28" style={{ marginRight: 6 }} />
          <div className="text hyper">Thread</div>
          <div className="text admin">Admin</div>
        </div>
      </div>
    );
  }
}

export default TopBanner;
