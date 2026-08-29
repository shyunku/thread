import uuid from 'react-native-uuid';

class SubTask {
  private _id: string;
  private _createdAt: Date | null = null;
  private _doneAt: Date | null = null;
  private _dueDate: Date | null;

  private _title: string | null;
  private _done: boolean = false;

  constructor(title: string, dueDate?: Date) {
    this._id = uuid.v4().toString();
    this._title = title;
    this._dueDate = dueDate ?? null;
  }

  public get id(): string {
    return this._id;
  }
  public set id(value: string) {
    this._id = value;
  }
  public get title(): string | null {
    return this._title;
  }
  public set title(value: string | null) {
    this._title = value;
  }
  public get done(): boolean {
    return this._done;
  }
  public set done(value: boolean) {
    this._done = value;
  }
  public get dueDate(): Date | null {
    return this._dueDate;
  }
  public set dueDate(value: Date | null) {
    this._dueDate = value;
  }
  public get createdAt(): Date | null {
    return this._createdAt;
  }
  public set createdAt(value: Date | null) {
    this._createdAt = value;
  }
  public get doneAt(): Date | null {
    return this._doneAt;
  }
  public set doneAt(value: Date | null) {
    this._doneAt = value;
  }
  public static fromJSON(json: any): SubTask {
    if (json instanceof SubTask) return json;
    let task = Object.create(SubTask.prototype);
    return Object.assign(task, json);
  }
}

export default SubTask;
