import mongoose from "mongoose";
import { MONGODB_URL } from "../../co.js";
async function myconnection(){
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/udemy_clone_v2');
        console.log('db connected');
    } catch (error) {
        console.log(error);
    }
}
export default myconnection;
