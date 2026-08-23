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
          <div className="text hyper">memo</div>
          <div className="text link">rial</div>
          <div className="text admin">Admin</div>
        </div>
      </div>
    );
  }
}

export default TopBanner;
