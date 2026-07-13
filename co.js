import dotenv from "dotenv";
dotenv.config();

let RAZORPAY_API_KEY = process.env.RAZORPAY_API_KEY;
let RAZORPAY_API_SECRET = process.env.RAZORPAY_API_SECRET;


export{
    RAZORPAY_API_KEY,
    RAZORPAY_API_SECRET
}