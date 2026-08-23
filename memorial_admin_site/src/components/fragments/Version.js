import { Component, createRef } from "react";
import axios from "axios";
import compareVersions from "compare-versions";
import moment from "moment";
import util from "static/js/util";

import { IoIosCloseCircle, IoMdClose, IoMdDownload } from "react-icons/io";
import { IoCheckmarkSharp } from "react-icons/io5";
import { ImCheckmark } from "react-icons/im";
import { AiFillAlert } from "react-icons/ai";

class Version extends Component {
  constructor(props) {
    super(props);

    this.state = {
      versions: [],
      latest_version: null,
      win_latest_version: null,
      mac_latest_version: null,
      alerted_latest_version: null,
      new_version_input: "",
      update_time_input: null,
      win_release_file: null,
      win_release_will_delete: false,
      win_release_upload_current: null,
      win_release_upload_total: null,
      win_release_upload_state: "initial",
      mac_release_file: null,
      mac_release_will_delete: false,
      mac_release_upload_current: null,
      mac_release_upload_total: null,
      mac_release_upload_state: "initial",
      create_new_draft: false,
      uploading: false,
      is_prelease: false,
      is_verified: false,
      edit_mode: false,
      editing_version_info: null,
      disk_usage: null,
    };

    this.winFileRef = createRef();
    this.macFileRef = createRef();

    this.diskUsageFetcher = util.fastInterval(() => {
      this.getDiskState();
    }, 3000);
  }

  componentDidMount = () => {
    this.fetchAlertedLatestVersion();
    this.fetchWinMacLatestVersion();
    this.fetchLatestVersion();
    this.fetchVersions();
    this.getDiskState();
  };

  componentWillUnmount = () => {
    clearInterval(this.diskUsageFetcher);
  };

  fetchLatestVersion = () => {
    axios
      .get(`${process.env.REACT_APP_RMS_ENTRY}/default/latest-version`)
      .then((res) => {
        const resp = res.data;
        if (resp.code === 200) {
          this.setState({
            latest_version: resp.data,
          });
        } else {
          switch (resp.code) {
            case 313:
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

  fetchWinMacLatestVersion = () => {
    axios
      .get(`${process.env.REACT_APP_RMS_ENTRY}/default/latest-version?category=win`)
      .then((res) => {
        const resp = res.data;
        if (resp.code === 200) {
          this.setState({
            win_latest_version: resp,
          });
        } else {
          switch (resp.code) {
            case 313:
              break;
            default:
              console.error(resp.code);
          }
        }
      })
      .catch((err) => {
        console.error(err);
      });

    axios
      .get(`${process.env.REACT_APP_RMS_ENTRY}/default/latest-version?category=mac`)
      .then((res) => {
        const resp = res.data;
        if (resp.code === 200) {
          this.setState({
            mac_latest_version: resp.data,
          });
        } else {
          switch (resp.code) {
            case 313:
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

  fetchAlertedLatestVersion = () => {
    axios
      .get(`${process.env.REACT_APP_RMS_ENTRY}/admin/alerted-latest-version`)
      .then((res) => {
        const resp = res.data;
        if (resp.code === 200) {
          this.setState({
            alerted_latest_version: resp.data,
          });
        } else {
          switch (resp.code) {
            default:
              console.error(resp.code);
          }
        }
      })
      .catch((err) => {
        console.error(err);
      });
  };

  fetchVersions = () => {
    axios
      .get(`${process.env.REACT_APP_RMS_ENTRY}/admin/versions`)
      .then((res) => {
        const resp = res.data;
        if (resp.code === 200) {
          console.log(resp);
          this.setState({
            versions: resp.data,
          });
        } else {
          switch (resp.code) {
            default:
              console.error(resp.code);
          }
        }
      })
      .catch((err) => {
        console.error(err);
      });
  };

  alertNewVersion = (version) => {
    axios
      .post(`${process.env.REACT_APP_RMS_ENTRY}/admin/alert-new-version`, { version })
      .then((res) => {
        const resp = res.data;
        if (resp.code === 200) {
          console.log(resp.data);
          alert(`Successfully alerted.`);
        } else {
          switch (resp.code) {
            default:
              console.error(resp.code);
              alert(`Alert Failed.`);
          }
        }

        this.fetchAlertedLatestVersion();
        this.fetchVersions();
      })
      .catch((err) => {
        console.error(err);
      });
  };

  deleteVersion = (version) => {
    axios
      .delete(`${process.env.REACT_APP_RMS_ENTRY}/admin/version?version=${version}`)
      .then((res) => {
        const resp = res.data;
        if (resp.code === 200) {
          if (this.state.edit_mode && version === this.state.editing_version_info?.version) {
            this.finalizeDraftPanel();
          }
          this.fetchLatestVersion();
          this.fetchVersions();
        } else {
          switch (resp.code) {
            default:
              console.error(resp.code);
          }
        }
      })
      .catch((err) => {
        console.error(err);
      });
  };

  getDiskState = () => {
    axios
      .get(`${process.env.REACT_APP_RMS_ENTRY}/admin/disk-status`)
      .then((res) => {
        const resp = res.data;
        if (resp.code === 200) {
          this.setState({
            disk_usage: resp.data,
          });
        } else {
          switch (resp.code) {
            default:
              console.error(resp.code);
          }
        }
      })
      .catch((err) => {
        console.error(err);
      });
  };

  createNewDraft = () => {
    this.finalizeDraftPanel();

    this.setState({
      create_new_draft: true,
      edit_mode: false,
    });
  };

  editDraft = (versionInfo) => {
    this.finalizeDraftPanel();

    let newData = {
      create_new_draft: true,
      new_version_input: versionInfo.version,
      edit_mode: true,
      editing_version_info: versionInfo,
      is_prelease: versionInfo.beta,
      update_time_input: versionInfo.updated_timestamp,
      is_verified: versionInfo.verified == true,
    };

    for (let release of versionInfo?.releases ?? []) {
      newData[`${release?.category ?? "*"}_release_file`] = {
        size: 0,
        name: release?.filename ?? "unknown",
        dummy: true,
      };
    }

    this.setState(newData);
  };

  inputChangeHandler = (e) => {
    this.setState({
      [`${e.target.name}_input`]: e.target.value,
    });
  };

  render() {
    const {
      versions,
      latest_version,
      win_latest_version,
      mac_latest_version,
      alerted_latest_version,
      create_new_draft,
      new_version_input,
      update_time_input,
      win_release_file,
      mac_release_file,
      win_release_upload_current,
      win_release_upload_total,
      win_release_upload_state,
      mac_release_upload_current,
      mac_release_upload_total,
      mac_release_upload_state,
      win_release_will_delete,
      mac_release_will_delete,
      uploading,
      edit_mode,
      is_prelease,
      is_verified,
      disk_usage,
    } = this.state;

    const latestVersion = latest_version?.version ?? "?";

    let versionValidity = compareVersions.validate(new_version_input);
    let latestVersionValidity = compareVersions.validate(latestVersion);
    // exclude latest (Temporary)
    let isLatest =
      true ||
      (versionValidity && latestVersionValidity
        ? compareVersions.compare(new_version_input, latestVersion, ">")
        : false);
    let canRelease = edit_mode || (versionValidity === true && isLatest);

    let freeDiskUsage = disk_usage?.free ?? 0;
    let totalDiskUsage = disk_usage?.total ?? 1;
    let usedDiskUsage = totalDiskUsage - freeDiskUsage;

    return (
      <>
        <div className="boxes">
          <div className="latest-version box">
            <div className="desc">Currently Latest Version</div>
            <div className="version">{latest_version?.version ?? "?"}</div>
            <div className="updated">
              {moment(Number(latest_version?.updated_timestamp)).format("YYYY.MM.DD hh:mm:ss A")}
            </div>
          </div>
          <div className="latest-version mac box">
            <div className="desc">Alerted Latest Version</div>
            <div className="version">{alerted_latest_version?.version ?? "?"}</div>
            <div className="updated">
              {moment(Number(alerted_latest_version?.updated_timestamp)).format("YYYY.MM.DD hh:mm:ss A")}
            </div>
          </div>
          <div className="latest-version win box">
            <div className="desc">Latest Windows Version</div>
            <div className="version">{win_latest_version?.version ?? "?"}</div>
            <div className="updated">
              {moment(Number(win_latest_version?.updated_timestamp)).format("YYYY.MM.DD hh:mm:ss A")}
            </div>
          </div>
          <div className="latest-version mac box">
            <div className="desc">Latest MacOS Version</div>
            <div className="version">{mac_latest_version?.version ?? "?"}</div>
            <div className="updated">
              {moment(Number(mac_latest_version?.updated_timestamp)).format("YYYY.MM.DD hh:mm:ss A")}
            </div>
          </div>
          <div className="disk-state box">
            <div className="desc">Disk Free Space</div>
            <div className="free">{disk_usage ? util.formatFileSize(disk_usage?.free ?? 0, 2) : "?"}</div>
            <div className="space">
              <div className="used-filler" style={{ width: `${(100 * usedDiskUsage) / totalDiskUsage}%` }}></div>
            </div>
          </div>
        </div>
        {/* <div className="alert-options">
                    <button className="danger">Broadcast New Version Release News</button>
                </div> */}
        <div className="version-panel">
          <div className="workspace-list-wrapper box expand">
            <div className="workspace-list">
              <div className="workspace-item header">
                <div className="version expand">Version</div>
                <div className="links mid">Link</div>
                <div className="update-date mid">Update Datetime</div>
                <div className="edit-date mid">Last Edit</div>
                <div className="downloads mid">
                  <IoMdDownload />
                </div>
                <div className="delete mid">Delete</div>
              </div>
              <div className="workspace-item custom">
                <button className="create expand" onClick={this.createNewDraft}>
                  + New Release Draft
                </button>
              </div>
              {versions
                .sort((a, b) => b.updated_timestamp - a.updated_timestamp)
                .map((versionInfo) => {
                  return (
                    <div
                      className="workspace-item version"
                      key={versionInfo.version}
                      onClick={(e) => this.editDraft(versionInfo)}
                    >
                      <div className={"version expand" + (versionInfo?.beta ?? true ? " beta" : "")}>
                        <div className="value">{versionInfo.version}</div>
                        <div className="tags">
                          {versionInfo?.verified == true && (
                            <>
                              <div className={"tag verified"}>
                                <ImCheckmark />
                                verified
                              </div>
                              {versionInfo?.alerted == true ? (
                                <div className={"tag alerted"}>
                                  <ImCheckmark />
                                  alerted
                                </div>
                              ) : (
                                <div
                                  className={"tag alert clickable"}
                                  onClick={(e) => this.alertNewVersion(versionInfo?.version)}
                                >
                                  <AiFillAlert />
                                  alert
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="links tags mid">
                        {(versionInfo?.releases ?? []).map((e) => (
                          <div
                            className={"tag clickable " + e.category}
                            onClick={this.onFileDownload}
                            downloadlink={e?.link ?? "about:blank"}
                            key={e.category}
                          >
                            {e.category}
                          </div>
                        ))}
                      </div>
                      <div className="update-date mid">
                        {moment(Number(versionInfo?.updated_timestamp)).format("YYYY.MM.DD hh:mm:ss A")}
                      </div>
                      <div className="edit-date mid">
                        {util.toRelativeTime(Number(versionInfo?.final_edit_timestamp))}
                      </div>
                      <div className="downloads mid">{versionInfo.download_count ?? 0}</div>
                      <button
                        className="delete mid"
                        onClick={(e) => {
                          this.deleteVersion(versionInfo.version);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
          <div className={"new-version-register-panel box" + (create_new_draft ? " active" : "")}>
            <div className="closer" onClick={this.finalizeDraftPanel}>
              <IoMdClose />
            </div>
            <div className="input-form">
              <div className="label">{edit_mode ? "Version" : "New Version"}</div>
              <input
                className="form-input"
                spellCheck={false}
                name="new_version"
                onChange={this.inputChangeHandler}
                readOnly={edit_mode}
                value={new_version_input}
              ></input>
              {!edit_mode && (
                <div className="version-error">
                  {uploading === false &&
                    (versionValidity === false
                      ? "version not valid"
                      : latestVersionValidity === false
                      ? "latest version not fetched"
                      : isLatest === false
                      ? "new version is lower than latest"
                      : "")}
                </div>
              )}
            </div>
            <div className="input-form">
              <div className="label">Release Options</div>
              <div className="release-options">
                <div className={"release-option" + (is_prelease ? " checked" : "")}>
                  <input
                    type="checkbox"
                    checked={is_prelease}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      this.setState({ is_prelease: checked });
                      if (checked) this.setState({ is_verified: false });
                    }}
                  ></input>
                  <div className="option-label">This is for beta test.</div>
                </div>
                <div className={"release-option" + (is_verified ? " checked" : "")}>
                  <input
                    type="checkbox"
                    disabled={is_prelease}
                    checked={is_verified}
                    onChange={(e) => this.setState({ is_verified: e.target.checked })}
                  ></input>
                  <div className="option-label">This is verified.</div>
                </div>
              </div>
            </div>
            <div className="input-form">
              <div className="label">Update Time</div>
              <input
                type="datetime-local"
                lang="en-us"
                value={moment(new Date(Number(update_time_input ?? Date.now())))
                  .local()
                  .format("YYYY-MM-DDTHH:mm:ss")}
                onChange={(e) => {
                  this.setState({ update_time_input: new Date(e.target.value).getTime() });
                }}
              ></input>
            </div>
            <div className="input-form expand">
              <div className="label">Update Contents (Not supported yet!)</div>
              <textarea readOnly></textarea>
            </div>
            <div className="input-form">
              <div className="label">Upload files</div>
              <div
                className={
                  "upload-form windows" +
                  (win_release_upload_state === "uploaded" ? " uploaded" : "") +
                  (edit_mode && win_release_will_delete ? " will-be-deleted" : "")
                }
                ref={this.winFileRef}
                category="win"
                label="Windows"
                onDragEnter={this.onFileDragEnter}
                onDrop={this.onFileDrop}
                onDragOver={this.onFileDragOver}
                onDragLeave={this.onFileDragLeave}
              >
                <div className="label">Windows</div>
                <div className="space"></div>
                <div className="filename">
                  {win_release_file
                    ? `${win_release_file.name} (${util.formatFileSize(win_release_file.size)})`
                    : `File not selected`}
                </div>
                {win_release_file && (
                  <div className="delete" category="win" onClick={this.onFileDelete}>
                    <IoIosCloseCircle />
                  </div>
                )}
                <div className="wrapper">Drop here!</div>
                <div className={"upload-state" + (win_release_upload_state === "uploading" ? " active" : "")}>
                  {win_release_upload_current && (
                    <>
                      <div className="label">
                        {`${util.formatFileSize(win_release_upload_current)} / ${util.formatFileSize(
                          win_release_upload_total
                        )} (${((100 * win_release_upload_current) / win_release_upload_total).toFixed(2)}%)`}
                      </div>
                      <div
                        className="bar"
                        style={{ width: `${(100 * win_release_upload_current) / win_release_upload_total}%` }}
                      ></div>
                    </>
                  )}
                </div>
              </div>
              <div
                className={
                  "upload-form mac-os" +
                  (mac_release_upload_state === "uploaded" ? " uploaded" : "") +
                  (edit_mode && mac_release_will_delete ? " will-be-deleted" : "")
                }
                ref={this.macFileRef}
                category="mac"
                label="MacOS"
                onDragEnter={this.onFileDragEnter}
                onDrop={this.onFileDrop}
                onDragOver={this.onFileDragOver}
                onDragLeave={this.onFileDragLeave}
              >
                <div className="label">MacOS</div>
                <div className="space"></div>
                <div className="filename">
                  {mac_release_file
                    ? `${mac_release_file.name} (${util.formatFileSize(mac_release_file.size)})`
                    : `File not selected`}
                </div>
                {mac_release_file && (
                  <div className="delete" category="mac" onClick={this.onFileDelete}>
                    <IoIosCloseCircle />
                  </div>
                )}
                <div className="wrapper">Drop here!</div>
                <div className={"upload-state" + (mac_release_upload_state === "uploading" ? " active" : "")}>
                  {mac_release_upload_current && (
                    <>
                      <div className="label">
                        {`${util.formatFileSize(mac_release_upload_current)} / ${util.formatFileSize(
                          mac_release_upload_total
                        )} (${((100 * mac_release_upload_current) / mac_release_upload_total).toFixed(2)}%)`}
                      </div>
                      <div
                        className="bar"
                        style={{ width: `${(100 * mac_release_upload_current) / mac_release_upload_total}%` }}
                      ></div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button className="release" onClick={this.releaseNewVersion} disabled={!canRelease}>
              {edit_mode ? "Edit" : "Release!"}
            </button>
          </div>
        </div>
      </>
    );
  }

  releaseNewVersion = async () => {
    const {
      new_version_input,
      win_release_file,
      mac_release_file,
      win_release_will_delete,
      mac_release_will_delete,
      is_prelease,
      is_verified,
      edit_mode,
      editing_version_info,
      update_time_input,
    } = this.state;

    if (new_version_input.length === 0) return;
    const data = {
      version: new_version_input,
      beta: is_prelease ? true : false,
      verified: is_verified ? true : false,
      update_time: update_time_input ?? Date.now(),
    };
    const isBeta = is_prelease ? "true" : "false";

    this.setState({
      uploading: true,
    });

    if (edit_mode) {
      await axios
        .post(`${process.env.REACT_APP_RMS_ENTRY}/admin/version`, data)
        .then((res) => {
          const resp = res.data;
          if (resp.code === 200) {
            this.fetchWinMacLatestVersion();
            this.fetchLatestVersion();
            this.fetchVersions();
          } else {
            switch (resp.code) {
              default:
                console.error(resp);
            }
          }
        })
        .catch((err) => {
          console.error(err);
        });
    } else {
      await axios
        .put(`${process.env.REACT_APP_RMS_ENTRY}/admin/version`, data)
        .then((res) => {
          const resp = res.data;
          if (resp.code === 200) {
            this.fetchWinMacLatestVersion();
            this.fetchLatestVersion();
            this.fetchVersions();
          } else {
            switch (resp.code) {
              default:
                console.error(resp.code);
            }
          }
        })
        .catch((err) => {
          console.error(err);
        });
    }

    const version = new_version_input;
    let formData, url, res, resp, config, filesize;

    try {
      if (edit_mode && win_release_will_delete) {
        url = `${process.env.REACT_APP_RMS_ENTRY}/admin/release?version=${editing_version_info.version}&category=win&beta=${isBeta}`;
        res = await axios.delete(url);
        resp = res.data;
        console.log("delete win", url, resp);
      } else if (win_release_file && win_release_file.dummy === false) {
        filesize = win_release_file.size;
        formData = new FormData();
        formData.append("file", win_release_file);
        config = {
          onUploadProgress: (e) => {
            this.setState({
              win_release_upload_current: e.loaded,
              win_release_upload_total: e.total,
            });
          },
          headers: {
            "Content-Type": "multipart/form-data",
          },
        };

        this.setState({
          win_release_upload_current: 0,
          win_release_upload_total: filesize,
          win_release_upload_state: "uploading",
        });

        url = `${process.env.REACT_APP_RMS_ENTRY}/admin/release?version=${version}&category=win&beta=${isBeta}`;
        res = await axios.put(url, formData, config);
        resp = res.data;
        console.log("update win", url, resp);

        this.setState({
          win_release_upload_state: "uploaded",
        });
      }
    } catch (err) {
      console.error(err);

      this.setState({
        win_release_upload_state: "failed",
      });
    } finally {
      this.setState({
        win_release_upload_current: null,
        win_release_upload_total: null,
      });
    }

    try {
      if (edit_mode && mac_release_will_delete) {
        url = `${process.env.REACT_APP_RMS_ENTRY}/admin/release?version=${editing_version_info.version}&category=mac&beta=${isBeta}`;
        res = await axios.delete(url);
        resp = res.data;
        console.log("delete mac", url, resp);
      } else if (mac_release_file && mac_release_file.dummy === false) {
        filesize = mac_release_file.size;
        formData = new FormData();
        formData.append("file", mac_release_file);
        config = {
          onUploadProgress: (e) => {
            this.setState({
              mac_release_upload_current: e.loaded,
              mac_release_upload_total: e.total,
            });
          },
          headers: {
            "Content-Type": "multipart/form-data",
          },
        };

        this.setState({
          mac_release_upload_current: 0,
          mac_release_upload_total: filesize,
          mac_release_upload_state: "uploading",
        });

        url = `${process.env.REACT_APP_RMS_ENTRY}/admin/release?version=${version}&category=mac&beta=${isBeta}`;
        res = await axios.put(url, formData, config);
        resp = res.data;
        console.log("update mac", url, resp);

        this.setState({
          mac_release_upload_state: "uploaded",
        });
      }
    } catch (err) {
      console.error(err);

      this.setState({
        mac_release_upload_state: "failed",
      });
    } finally {
      this.setState({
        mac_release_upload_current: null,
        mac_release_upload_total: null,
      });
    }

    this.fetchWinMacLatestVersion();
    this.fetchVersions();
    this.finalizeDraftPanel();
    this.getDiskState();
  };

  onFileDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const extensions = {
      win: ["exe"],
      mac: ["dmg"],
    };

    const element = e.target;
    const file = e.dataTransfer.files[0];
    const category = element.getAttribute("category");
    const label = element.getAttribute("label");
    const stateName = `${category}_release_file`;
    const fileName = file.name;

    const segments = fileName.split(".");
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : "_";
    const validExtensions = extensions[category];

    if (!validExtensions.includes(lastSegment)) {
      alert(`${label} uploader supports these extensions: [ ${validExtensions.join(", ")} ], given: ${lastSegment}`);
    } else {
      console.log(category, file);

      element.classList.add("will-be-uploaded");
      file.dummy = false;

      console.log(element.classList);

      this.setState({
        [stateName]: file,
      });
    }

    if (this.state.edit_mode) {
      this.setState({
        [`${category}_release_will_delete`]: false,
      });
    }

    this.onFileDragLeave(e);
  };

  onFileDelete = (e) => {
    let element = e.target;
    const category = element.getAttribute("category");

    if (this.state.edit_mode) {
      this.setState({
        [`${category}_release_will_delete`]: true,
      });
    } else {
      const stateName = `${category}_release_file`;

      this[`${category}FileRef`]?.current?.classList?.remove("will-be-uploaded");

      this.setState({
        [stateName]: null,
      });
    }
  };

  onFileDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  onFileDragEnter = (e) => {
    e.target.classList.add("drag-over");
  };

  onFileDragLeave = (e) => {
    e.target.classList.remove("drag-over");
  };

  onFileDownload = (e) => {
    e.stopPropagation();
    const element = e.target;
    const downloadLink = element.getAttribute("downloadlink");
    window.location.href = downloadLink;
  };

  finalizeDraftPanel = () => {
    this.winFileRef.current?.classList?.remove("will-be-uploaded");
    this.macFileRef.current?.classList?.remove("will-be-uploaded");

    this.setState({
      new_version_input: "",
      create_new_draft: false,
      is_prelease: false,
      is_verified: false,
      uploading: false,
      win_release_upload_state: "initial",
      mac_release_upload_state: "initial",
      win_release_will_delete: false,
      mac_release_will_delete: false,
      win_release_file: null,
      mac_release_file: null,
      edit_mode: false,
      editing_version_info: null,
      update_time_input: null,
    });
  };
}

export default Version;
