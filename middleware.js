function req_user(req,res,next){
    if(req?.headers?.['x-user-data'])
        req.user = JSON.parse(req.headers['x-user-data']);
    next();
}

export {req_user};