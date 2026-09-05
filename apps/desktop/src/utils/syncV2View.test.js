import { fromSyncV2View } from "./syncV2View";
import Task from "../objects/Task";
import Category from "../objects/Category";
import Subtask from "../objects/Subtask";

test("v2 rows reuse UI models, order, dates, secret/color and parent relationships", () => {
 const view=fromSyncV2View({
  tasks:[{tid:"a",title:"A",created_at:100,done_at:0,due_date:200,next:"b"},{tid:"b",title:"B",next:null}],
  categories:[{cid:"c",title:"C",secret:true,locked:true,color:"#abc"}],
  subtasks:[{tid:"a",sid:"s",title:"S",done:true,done_at:300}],
  relations:[{tid:"a",cid:"c"}],
 });
 expect(view.taskMap.a).toBeInstanceOf(Task);
 expect(view.taskMap.a.next).toBe(view.taskMap.b);
 expect(view.taskMap.b.prev).toBe(view.taskMap.a);
 expect(view.taskMap.a.doneAt).toBeNull();
 expect(view.taskMap.a.dueDate.getTime()).toBe(200);
 expect(view.taskMap.a.subtasks.s).toBeInstanceOf(Subtask);
 expect(view.categories.c).toBeInstanceOf(Category);
 expect(view.categories.c.locked).toBe(true);
 expect(view.categories.c.color).toBe("#abc");
 expect(view.taskMap.a.categories.c).toBe(true);
 expect(fromSyncV2View({tasks:[],categories:[],subtasks:[],relations:[]}).taskMap.a).toBeUndefined();
});
