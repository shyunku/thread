jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../public/electron/modules/util", () => ({
  getSystemArchCategory: () => "win",
}));
jest.mock("../../public/electron/modules/filesystem", () => ({
  getUserDataPath: () => "fixture",
}));
const axios = require("axios");
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
test("coalesces socket/poll requests and automatically downloads mandatory releases once", async () => {
  axios.get.mockResolvedValue({
    data: { code: 200, data: [{ version: "2.0.0", mandatory: true }] },
  });
  const service = new ReleaseAlertService();
  const download = jest.fn().mockResolvedValue("fixture/2.0.0.exe");
  service.inject({
    ipcService: { sender: jest.fn() },
    updaterService: { updateToNewVersion: download },
  });
  await Promise.all([service.check(), service.check()]);
  await service.downloading;
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(download).toHaveBeenCalledTimes(1);
  expect(service.current.status).toBe("ready");
  await service.check();
  expect(download).toHaveBeenCalledTimes(1);
});
test("optional releases wait for selection; failed required downloads retry without quitting", async () => {
  const service = new ReleaseAlertService();
  const download = jest.fn().mockRejectedValue(Error("offline"));
  service.inject({
    ipcService: { sender: jest.fn() },
    updaterService: { updateToNewVersion: download },
  });
  axios.get.mockResolvedValue({
    data: { code: 200, data: [{ version: "2.0.0", mandatory: false }] },
  });
  await service.check();
  expect(download).not.toHaveBeenCalled();
  axios.get.mockResolvedValue({
    data: { code: 200, data: [{ version: "2.0.0", mandatory: true }] },
  });
  await service.check();
  await service.downloading;
  expect(service.current.status).toBe("failed");
  download.mockResolvedValue("fixture/2.0.0.exe");
  await service.check();
  await service.downloading;
  expect(service.current.status).toBe("ready");
  axios.get.mockRejectedValue(Error("offline"));
  await service.check();
  expect(service.current.mandatory).toBe(true);
});
