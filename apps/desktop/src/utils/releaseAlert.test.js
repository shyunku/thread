jest.mock("../../public/electron/modules/util", () => ({
  getSystemArchCategory: () => "win",
}));
jest.mock("../../public/electron/modules/filesystem", () => ({
  getUserDataPath: () => "fixture",
}));
jest.mock("electron", () => ({app:{exit:jest.fn(),relaunch:jest.fn()}}));
const latest=jest.fn();
const {
  ReleaseAlertService,
  selectRelease,
} = require("../../public/electron/service/releaseAlert.service");

beforeEach(() => jest.clearAllMocks());
test("ignores current/older/invalid/beta versions and carries mandatory boundary forward", () => {
  expect(
    selectRelease(
      [
        { version: "1.1.1" },
        { version: "1.0.0" },
        { version: "bad" },
        { version: "3.0.0", beta: true },
      ],
      "1.1.1"
    )
  ).toBeNull();
  const releases = [
    { version: "1.2.0", mandatory: true },
    { version: "1.3.0" },
  ];
  expect(selectRelease(releases, "1.1.1")).toEqual({
    version: "1.3.0",
    mandatory: true,
  });
  expect(selectRelease(releases, "1.2.0")).toEqual({
    version: "1.3.0",
    mandatory: false,
  });
});
test("coalesces socket/poll requests without downloading mandatory releases", async () => {
  latest.mockResolvedValue({version:"2.0.0",mandatory:true});
  const service = new ReleaseAlertService();
  const download = jest.fn().mockResolvedValue("fixture/2.0.0.exe");
  service.inject({
    ipcService: { sender: jest.fn() },
    updaterService: { updateToNewVersion: download, latestTrustedRelease:latest },
  });
  await Promise.all([service.check(), service.check()]);
  expect(latest).toHaveBeenCalledTimes(1);
  expect(download).not.toHaveBeenCalled();
  expect(service.current.status).toBe("available");
  await service.download();
  expect(download).toHaveBeenCalledTimes(1);
  expect(service.current.status).toBe("ready");
  await service.check();
  expect(download).toHaveBeenCalledTimes(1);
});
test("failed required downloads only retry after another explicit selection", async () => {
  const service = new ReleaseAlertService();
  const download = jest.fn().mockRejectedValue(Error("offline"));
  service.inject({
    ipcService: { sender: jest.fn() },
    updaterService: { updateToNewVersion: download, latestTrustedRelease:latest },
  });
  latest.mockResolvedValue({version:"2.0.0",mandatory:false});
  await service.check();
  expect(download).not.toHaveBeenCalled();
  latest.mockResolvedValue({version:"2.0.0",mandatory:true});
  await service.check();
  expect(download).not.toHaveBeenCalled();
  await service.download();
  expect(service.current.status).toBe("failed");
  download.mockResolvedValue("fixture/2.0.0.exe");
  await service.check();
  expect(service.current.status).toBe("failed");
  await service.download();
  expect(service.current.status).toBe("ready");
  latest.mockRejectedValue(Error("offline"));
  await service.check();
  expect(service.current.mandatory).toBe(true);
});
test("installation requires a downloaded installer and delegates byte verification",async()=>{
 const service=new ReleaseAlertService(),install=jest.fn().mockResolvedValue(false);
 service.inject({updaterService:{installNewVersion:install}});
 await expect(service.install()).rejects.toThrow("INSTALLER_NOT_READY");
 service.current={version:"2.0.0",status:"ready"};service.installerPath="fixture/verified.exe";
 await service.install();
 expect(install).toHaveBeenCalledWith("win","fixture","fixture/verified.exe");
 expect(require("electron").app.exit).toHaveBeenCalledTimes(1);
});

test("one-step update downloads, then installs and restarts unless cancelled", async () => {
  latest.mockResolvedValue({ version: "2.0.10", mandatory: false });
  let finish;
  const download = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const install = jest.fn().mockResolvedValue(false);
  const service = new ReleaseAlertService();
  service.inject({ updaterService: { updateToNewVersion: download, latestTrustedRelease: latest, installNewVersion: install } });
  await service.check();
  // Cancelled while downloading: the download finishes but nothing installs.
  let running = service.update();
  await Promise.resolve();
  expect(service.current).toMatchObject({ status: "downloading", autoInstall: true });
  service.cancel();
  expect(service.current.autoInstall).toBe(false);
  finish("fixture/2.0.10.exe");
  await running;
  expect(service.current.status).toBe("ready");
  expect(install).not.toHaveBeenCalled();
  // Already downloaded: update installs right away and exits.
  await service.update();
  expect(install).toHaveBeenCalledWith("win", "fixture", "fixture/2.0.10.exe");
  expect(require("electron").app.exit).toHaveBeenCalledTimes(1);
});

test("a failed install or download leaves a retryable state", async () => {
  latest.mockResolvedValue({ version: "2.0.10", mandatory: true });
  const download = jest.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue("fixture/2.0.10.exe");
  const install = jest.fn().mockRejectedValueOnce(Error("UPDATE_VERIFY_FAILED")).mockResolvedValue(false);
  const service = new ReleaseAlertService();
  service.inject({ updaterService: { updateToNewVersion: download, latestTrustedRelease: latest, installNewVersion: install } });
  await service.check();
  await service.update();
  expect(service.current).toMatchObject({ status: "failed", autoInstall: false });
  await expect(service.update()).rejects.toThrow("UPDATE_VERIFY_FAILED");
  expect(service.current).toMatchObject({ status: "ready", autoInstall: false, installFailed: true });
  await service.update();
  expect(install).toHaveBeenCalledTimes(2);
  expect(require("electron").app.exit).toHaveBeenCalledTimes(1);
});

test("a newer version found while another downloads waits for it, then downloads itself", async () => {
  let finishOld;
  const download = jest.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValue("fixture/2.0.11.exe");
  const install = jest.fn().mockResolvedValue(false);
  const service = new ReleaseAlertService();
  service.inject({ updaterService: { updateToNewVersion: download, latestTrustedRelease: latest, installNewVersion: install } });
  latest.mockResolvedValue({ version: "2.0.10", mandatory: false });
  await service.check();
  const old = service.download();
  latest.mockResolvedValue({ version: "2.0.11", mandatory: false });
  await service.check();
  const running = service.update();
  await Promise.resolve();
  expect(download).toHaveBeenCalledTimes(1);
  finishOld("fixture/2.0.10.exe");
  await old;
  await running;
  expect(download).toHaveBeenLastCalledWith("win", "fixture", "2.0.11");
  expect(install).toHaveBeenCalledWith("win", "fixture", "fixture/2.0.11.exe");
});
