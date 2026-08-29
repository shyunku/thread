import uuid from 'react-native-uuid';

class Category {
  private _id: string;
  private _title: string;
  private _createdAt: Date | null = null;
  private _secret: boolean;
  private _locked: boolean = false;
  private _color: string | null = null;
  private _isDefault: boolean;

  constructor(title: string, secret: boolean, isDefault: boolean) {
    this._id = uuid.v4().toString();
    this._title = title;
    this._secret = secret;
    this._isDefault = isDefault;
    this._createdAt = new Date();
  }

  public get id(): string {
    return this._id;
  }
  public set id(value: string) {
    this._id = value;
  }
  public get title(): string {
    return this._title;
  }
  public set title(value: string) {
    this._title = value;
  }
  public get createdAt(): Date | null {
    return this._createdAt;
  }
  public set createdAt(value: Date | null) {
    this._createdAt = value;
  }
  public get secret(): boolean {
    return this._secret;
  }
  public set secret(value: boolean) {
    this._secret = value;
  }
  public get locked(): boolean {
    return this._locked;
  }
  public set locked(value: boolean) {
    this._locked = value;
  }
  public get color(): string | null {
    return this._color;
  }
  public set color(value: string | null) {
    this._color = value;
  }
  public get isDefault(): boolean {
    return this._isDefault;
  }
  public set isDefault(value: boolean) {
    this._isDefault = value;
  }
  public static fromJSON(json: any): Category {
    if (json instanceof Category) return json;
    let task = Object.create(Category.prototype);
    return Object.assign(task, json);
  }
}

export default Category;
