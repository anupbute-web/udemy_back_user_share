import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken'; 
import {req_user} from './middleware.js'
import userModel from './models/userSchema.js';
import myconnection from './models/db_connect/db.js';
import courseModel from './models/courseSchema.js';
import crypto from 'crypto';
import { RAZORPAY_API_KEY , RAZORPAY_API_SECRET } from './co.js';
import mongoose from 'mongoose';
import Razorpay from 'razorpay';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();  

app.use(cors({origin:'http://localhost:3000',credentials: true}));
app.use(cookieParser());
app.use(express.json());
app.use(req_user);

const razorpayInstance = new Razorpay({
    key_id : RAZORPAY_API_KEY,
    key_secret : RAZORPAY_API_SECRET,
});

(async()=>{
    try {
        await myconnection()
        console.log('db connected')
    } catch (error) {
        console.log(error)
    }
})();   

let filepath = path.join(__dirname,'user.proto');
let loadedfile = protoLoader.loadSync('./user.proto');
let myproto = grpc.loadPackageDefinition(loadedfile).home;

let client = new myproto.GetCourseInfo('127.0.0.1:50051',grpc.credentials.createInsecure())

app.post('/user/payments/create-order',async (req,res)=>{
    try { 
        let course = req.body.course;
        let user = req.user;
        if(!user)
            return res.json({success:false , data:null , error:null , msg:'unauthorized'});
        if(course.length <= 0) 
            return res.json({success:false , data:null , error:null , msg:'add courses to cart'});

        //////////////////////////////////////////////// gRPC call to uer service needed for fetching current prices for course ///////////////////////////////////

        let {amount,ids} = course.reduce(
            (acc,item) => {
                acc.amount += Number(item.price)*100;
                acc.ids.push(item._id);
                return acc
            },
            {amount:0 , ids:[]}
        );

        let price = (await courseModel.find(
            {_id:{$in:ids}},
            {price:1}
        )).reduce((acc,item) => acc + Number(item.price)*100,0);

        if(price !== amount) 
            return res.json({success:false , data:null , error:null , msg:'something went wrong'});

        let options = {
            amount,
            currency:'INR',
            notes:{
                userId:user._id,
                course:ids
            }
        }

        let order = await razorpayInstance.orders.create(options);
        res.json({success:true , msg:'order created' , data:order , error:null});
    } catch (error) {
        console.log(error);
        res.json({success:false , data:null , error:null , msg:'server error'});
    }
});

app.post('/user/payments/verify',async(req,res)=>{
    try {
        let { razorpay_payment_id , razorpay_order_id , razorpay_signature , notes } = req.body;
        if(!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
            return res.json({success:false , data:null , error:null , msg:'something went wrong'});
        
        let sign = crypto
        .createHmac('sha256',RAZORPAY_API_SECRET)
        .update(razorpay_order_id + '|' + razorpay_payment_id)
        .digest('hex');
        
        if(sign !== razorpay_signature)
            return res.redirect('http://localhost:3000/payment/failed');

        //////////////////////////////////////////////// gRPC call to uer service needed to check idempotency ///////////////////////////////////

        await userModel.findByIdAndUpdate(notes.userId,{$addToSet:{learnings:notes.course}});
        
        res.json({success:true , data:null , error:null , msg:'server error'});
    } catch (error) {
        console.log(error);
        res.json({success:false , data:null , error:null , msg:'server error'});
    }
})

app.get('/user/accountSettings',async (req,res) => {
    try {
        let user = req.user;
        if(!user) return res.json({success:false , msg:'unauthorized' , data:null , error:null});
        
        let userDb = await userModel.findOne({email:user.email},{password:1}).lean();
        
        res.json({success:true , msg:'data sent' , data:{hasPass:userDb.hasOwnProperty('password')} , error:null});
    } catch (error) {
        console.log(error);
        res.status(500).json({success:false , msg:'server error' , data:null , error});
    }
}) 

app.get('/user/basic-info',async(req,res)=>{
    try {
        let user = req.user; 
        if(!user) return res.status(401).json({success:false , msg:'unauthorized,user,150' , data:null , error:null});
        let userDb = await userModel.findOne({email:user.email}).lean();

        if(!userDb) {
            res.clearCookie('access_token', {httpOnly:true , secure:true});
            res.clearCookie('refresh_token', {httpOnly:true , secure:true});
            return res.json({success:false , msg:'unauthorized' , data:null , error:null});
        }    
        const {username,...rest} = userDb;
        userDb = { ...rest,name:username };
        // console.log(userDb);
        res.json({success:true , msg:'data send' , data:userDb , error:null});
    } catch (error) {
        console.log(error);
        res.json({success:false , msg:'server error' , data:null , error:error});
    }
});

app.patch('/user/basic-info',async(req,res)=>{
    try{
        let [user,profileData] = [req.user,req.body];
        if(!profileData) return res.status(401).json({success:false, msg:'feilds empty' , data:null , error:null});

        if(!user) {
            res.clearCookie('access_token', {httpOnly:true , secure:true});
            res.clearCookie('refresh_token', {httpOnly:true , secure:true});
            return res.json({success:false , msg:'unauthorized' , data:null , error:null});
        }  

        let newUser = await userModel.findByIdAndUpdate(user._id,{$set:profileData},{new:true , runValidators:true});

        res.json({success:true , msg:'success' , data:newUser , error:null});

    }catch(err){
        console.log(err);
        res.json({success:false , msg:'server error' , data:null , error:err});
    }
});

app.get('/user/learnings',async(req,res)=>{
    try {
        let user = req.user;
        if(!user) return res.status(401).json({success:false , msg:'unauthorizd' , data:null , error:null});

        let dbUser = await userModel.findOne({_id:user._id},{_id:1}).populate('learnings','_id url title instructor content_duration sections').lean();
        if(!dbUser) return res.json({success:false , msg:'user not found' , data:null , error:null});

        console.log(dbUser)
        let learnings = dbUser.learnings.map(({sections,...rest}) => ({sections:sections.length,...rest}));

        console.log(learnings)
 
        let data = learnings || [];
 
        res.json({success:true , msg:'data found' , data , error:null});
    } catch (error) {
        console.log(error);
        res.json({success:false , msg:'server error' , data:null , error});
    }
});

app.get('/user/cart',async(req,res)=>{
    try {
        let user = req.user;
        if(!user) return res.status(401).json({success:false , msg:'unauthorized' , data:null , error:null});

        let dbUser = await userModel.findOne({_id:user._id}).populate('cart','_id imgUrl title instructor content_duration price sections');
        if(!dbUser) return res.json({success:false , msg:'user not found' , data:null , error:null});

        for(let i=0;i<dbUser.cart.length;i++){
            dbUser.cart[i].sections = dbUser.cart[i].sections.length
        }
        let cartData = dbUser.cart || [];

        res.json({success:true , msg:'data found' , data:cartData , error:null});
    } catch (error) {
        console.log(error);
        res.json({success:false , msg:'server error' , data:null , error});
    }
});
 
app.get('/user/cart/:_id',async(req,res)=>{
    try {
        let user = req.user;
        // if(!user) return res.status(401).json({success:false , msg:'unauthorized' , data:null , error:null});
        console.log(req.params._id);


        client.CourseInfo({id:req.params._id},(error,data)=>{
            console.log("object")
            if(!error){
                console.log("data")
                return res.json({success:true , msg:'data found' , data , error:null});
            }else return res.json({success:false , msg:'course not found' , data:null , error});
            console.log("object2")
        });
    } catch (error) {
        console.log(error);
        res.json({success:false , msg:'server error' , data:null , error});
    }
});

app.post('/user/cart',async(req,res)=>{
    try {
        let courseId = req.body.courseId;
        let user = req.user;

        if(!user || !courseId) 
            return res.status(401).json({success:false , msg:'login/register first' , data:null , error:null});

        courseId = new mongoose.Types.ObjectId(courseId);

        if(!await userModel.findByIdAndUpdate(user._id,{$addToSet:{cart:courseId}}))  
            return res.json({success:false , msg:'user not found' , data:null, error:null});

        res.json({success:true , msg:'added to cart' , data:null , error:null});
    } catch (error) {
        console.log(error);
        res.json({success:false , msg:'server error' , data:null, error});
    }
});

app.delete('/user/cart/:courseId',async(req,res)=>{
    try {
        let courseId = req.params.courseId;
        let user = req.user;
 
        if(!user || !courseId) return res.status(401).json({success:false , msg:'login/register first' , data:null , error:null});
        courseId = new mongoose.Types.ObjectId(courseId);
        if(!await userModel.findByIdAndUpdate(user._id,{$pull:{cart:courseId}}))  
            return res.json({success:false , msg:'user not found' , data:null, error:null});

        res.json({success:true , msg:'course removed' , data:null , error:null});
    } catch (error) {
        console.log(error);
        res.json({success:false , msg:'server error' , data:null, error});
    }
});



app.listen(4043, () => console.log(`user_service on 4043`));

