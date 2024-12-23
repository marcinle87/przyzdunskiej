import { env } from '$env/dynamic/private';
import { MYDR_URL, MYDR_CLIENT_ID, MYDR_CLIENT_SECRET, MYDR_USER, MYDR_PASSWORD, MYDR_CURTOKEN_BEARER, MYDR2_CURTOKEN_REFRESH} from '$env/static/private'
import { MYDR2_CLIENT_ID, MYDR2_CLIENT_SECRET, MYDR2_USER, MYDR2_PASSWORD, MYDR2_CURTOKEN_BEARER} from '$env/static/private'
import { ResultCode, type Result, removeNulls, buildUrlQueryData, type Address, type User } from '$lib/utils';
import { isEmpty } from 'validator';
import { boolean, date, number, z } from 'zod';

export const officeDepartment:{[key:string]: string} = {
    "58155": "49435",
    "59880": "51934", //Ginekolog
    "59881": "51934" //Ginekolog
}
export const depInitTokenReq:{[key:string]: object} = {
    "_": {
        grant_type: "password",
        username: MYDR_USER,
        password: MYDR_PASSWORD,
        client_id: MYDR_CLIENT_ID,
        client_secret: MYDR_CLIENT_SECRET
    },
    "51934": {
        //Ginekolog:
        grant_type: "password",
        username: MYDR2_USER,
        password: MYDR2_PASSWORD,
        client_id: MYDR2_CLIENT_ID,
        client_secret: MYDR2_CLIENT_SECRET
    }
}
const depRefreshTokenReq:{[key:string]: object} = {
    "_": {
        grant_type: "refresh_token",
        client_id: MYDR_CLIENT_ID,
        client_secret: MYDR_CLIENT_SECRET
    },
    "51934": {
        //Ginekolog:
        grant_type: "refresh_token",
        client_id: MYDR2_CLIENT_ID,
        client_secret: MYDR2_CLIENT_SECRET
    }
}

export interface MyDrUser extends User {
    residence_address?: Address;
    registration_address?: Address;
}
export type Staff = {
    id?: number,
    email: string,
    first_name: string,
    last_name: string,
    pesel?: string,
    telephone?: string,
    username?: string,
    profession_code?: string,
    pwz?: string
}
export type QResponse<T> = {
    current_page?: number,
    last_page?: number,
    count?: number,
    next?: string,
    previous?: string,
    results: T[],
    [key: string]: any;
}
export type Declaration = {
    id: number,
    creation_date: string,
    deletion_date?: string,
    personnel?: number,
    personnel_name?: string,
    type?: string,
    department?: number,
    department_name?: string,
    state?: string,
    ward_type?: string,
    note?: string,
    prof_fluor?: string,
    typ_szkoly_plat?: string,
    school_regon?: string,
    school_kind?: string
}
export enum VisitKind {
    NFZ = "NFZ",
    Private = "Prywatna"
}
export type Visit = {
    id?: number,
    patient?: number|null,
    doctor: number,
    office: number,
    date: string,
    timeFrom?: string,
    timeTo?: string,
    state?: string,
    visit_type?: number[],
    interview?: string,
    recommendation?: string,
    examination?: string,
    visit_kind?: VisitKind,
    note?: string,
    recognition_description?: string,
    confirmed?: boolean,
    latest_modification?: string
}
// export const visitSchema: z.ZodType<Visit> = z.object({
//     patient: z.string({required_error: "Patien"})
// });
export class MyDrGetter<T> {
    static async newInstance<U>(apiPath:string, reqHeaders?: any, queryData?: object|null): Promise<MyDrGetter<U>> {
        const urlStr = MYDR_URL + apiPath + "?" + buildUrlQueryData(queryData);
        const reqInit: RequestInit = {
            method: "GET",
        }
        if(reqHeaders) {
            reqInit.headers = reqHeaders;
        }
        const instance = new MyDrGetter<U>(urlStr, reqInit);
        return instance.load();
    }

    ok: boolean = false;
    status: number = 0;
    index: number = 0;
    results: T[] = [];
    urlStr: string;
    private _next: MyDrGetter<T>|null;
    private _prev: MyDrGetter<T>|null;
    private _nextUrl?:string;
    cfgReq: RequestInit;
    private constructor(urlStr: string, reqInit: RequestInit, prev?: MyDrGetter<T>) {
        this.urlStr = urlStr;
        this.cfgReq = reqInit;
        this._prev = prev ? prev : null;
        this._next = null;
    }
    async load():Promise<MyDrGetter<T>> {
        console.log("Fetching " + this.urlStr);// + " with headers " + JSON.stringify(this.cfgReq));
        let res = await fetch(this.urlStr, this.cfgReq);
        this.status = res.status;
        this.ok = res.status >= 200 && res.status < 300 ;
        if(!this.ok) {
            console.log("Failed to fetching request " + this.urlStr + ", HTTP status: " + res.status + ", " + (await res.text))
            this.results = [];
            return this;
        }
        
        const current = (await res.json()) as QResponse<T>;
        this.index = current.current_page || 0;
        this.results = current.results ? current.results : [];
        if(current.next && this.status >= 200 && this.status < 300) {
            this._nextUrl = current.next;
        }
        return this;
    }
    size(): number {
        return this.results.length;
    }
    hasNext(): boolean {
        return this._nextUrl ? true : false;
    }
    public async next():Promise<MyDrGetter<T>|null> {
        if(this.status == 0) {
            return this.load();
        }
        if(!this._nextUrl) {
            return null;
        }
        if(this._next) return this._next;
        this._next = new MyDrGetter(this._nextUrl, this.cfgReq, this);
        this._next.index = this.index + 1;
        return await this._next.load();
    }
    public async forEach(callbackfn: (value: T[], index: number) => boolean|Promise<boolean>) {
        let iter: MyDrGetter<T> | null = this;
        let cont = callbackfn(iter.results, iter.index);
        const isPromise = typeof cont != "boolean";
        if(isPromise) {
            cont = await cont;
        }
        while(cont) {
            iter = await iter.next();
            if(iter == null) break;
            cont = callbackfn(iter.results, iter.index);
            if(isPromise) {
                cont = await cont;
            }
        }
    }
}
export class MyDr {
    static async newInstance(office?: string|null, department?: string|null): Promise<MyDr> {
        let dep = department
        if(!dep) {
            dep = office ? officeDepartment[office] : "_";
        }
        if(!depInitTokenReq[dep]) {
            dep = "_";
        }
        let token = globalThis.myDrToken.get(dep);
        if(!token) {
            token = await requestToken(depInitTokenReq[dep]);
            globalThis.myDrToken.set(dep, token);
            //env.MYDR2_CURTOKEN_REFRESH = token.refresh_token;
        } else {
            const current = Date.now();
            console.log("Current time: " + current + ". token expire in: " + token.expires_in);
            if(token.expires_in <= current) {
                console.log("Refreshing token...")
                //Use below to reuse token from env:
                // let req = globalThis.myDrToken == null ? depRefreshTokenReq[department]
                //             : {refresh_token: globalThis.myDrToken.get(department).refresh_token, ...depRefreshTokenReq[department]};
                let req = {refresh_token: globalThis.myDrToken.get(dep).refresh_token, ...depRefreshTokenReq[dep]};
                token = await requestToken(req);
                globalThis.myDrToken.set(dep, token);
            }
        }
        console.log("Token: " + token.access_token)
        return new MyDr(token.access_token);
    }
    requiredColumns: string[] = ["name", "surname", "pesel"];
    token: string;
    headers: any;
    page_size = 100;
    private constructor(token : string) {
        this.token = token;
        this.headers = {
            'Authorization': "Bearer " + this.token
        }
    }
    async newPatientGetter(queryData: object): Promise<MyDrGetter<MyDrUser>> {
        return MyDrGetter.newInstance<MyDrUser>("/patients", this.headers, queryData);
    }
    async newDeclareGetter(patientPk: string, queryData?: object): Promise<MyDrGetter<Declaration>> {
        const apiPath = "/patients/" + patientPk + "/declarations/";
        return MyDrGetter.newInstance<Declaration>(apiPath, this.headers, queryData);
    }
    async newVisitGetter(patientPk: string, queryData?: object): Promise<MyDrGetter<Visit>> {
        const apiPath = "/patients/" + patientPk + "/visits/";
        return MyDrGetter.newInstance<Visit>(apiPath, this.headers, queryData);
    }

    async getOneDeclaration(patient_pk: number): Promise<Declaration | null> {
        let results: Array<Declaration> = new Array<Declaration>();
        let getter:MyDrGetter<Declaration>|null = await this.newDeclareGetter(patient_pk.toString());
        let declraration: Declaration|null = null;
        await getter.forEach((declrs: Declaration[], _) => {
            for(let declr of declrs) {
                console.log("deletion date: " + declr.deletion_date);
                if(!declr.deletion_date || declr.deletion_date === null || declr.deletion_date.length === 0) {
                    declraration = declr;
                    break;
                }
            }
            return declraration === null; //return continuation condition
        });
        return declraration;
    }
    async getStaffByPk(id: string | number, role: ("doctors" | "nurses" | "receptionists") ): Promise<Staff|null> {
        const urlStr = MYDR_URL + "/" + role + "/" + id.toString();
        const reqInit: RequestInit = {
            method: "GET",
            headers: this.headers
        }
        let res = await fetch(urlStr, reqInit);
        let ok = res.status >= 200 && res.status < 300 ;
        if(!ok) {
            console.log("Failed to fetching request " + urlStr + ", HTTP status: " + res.status + ", " + (await res.text))
            return null;
        }
        return (await res.json()) as Staff;
    }
    async getDoctorByPk(id: number): Promise<Staff|null> {
        return this.getStaffByPk(id, "doctors");
    }

    async getPatientByPk(id: number): Promise<MyDrUser|null> {
        const urlStr = MYDR_URL + "/patients/" + id.toString();
        console.log("Requesting " + urlStr);
        const reqInit: RequestInit = {
            method: "GET",
            headers: {"Content-Type": "application/json", ...this.headers}
        }
        let res = await fetch(urlStr, reqInit);
        let ok = res.status >= 200 && res.status < 300 ;
        if(!ok) {
            console.log("Failed to fetching request " + urlStr + ", HTTP status: " + res.status + ", " + (await res.text()))
            return null;
        }
        const patient = await res.json();
        //console.log("Returned patient: " + JSON.stringify(patient));
        return patient;
    }
    async getOnePatient(queryData: object): Promise<MyDrUser|null> {
        let getter: MyDrGetter<MyDrUser>|null = await this.newPatientGetter(queryData);
        let user: MyDrUser|null = null;
        await getter.forEach(async (patients: MyDrUser[], _) => {
            for(let i = 0; i < patients.length; i++) {
                if(!patients[i].active) continue;
                let declr = await this.getOneDeclaration(patients[i].id as number);
                if(declr) {
                    user = patients[i];
                    break;
                } 
            }
            return user === null;
            //Query declarations in paralel, if anyone is ok then resolve promise, ignore other queries
            // return new Promise<boolean>((resolve, _) => {
            //     let repCount = 0;
            //     for(let i = 0; i < patients.length; i++) {
            //         if(!patients[i].active) continue;
            //         this.getOneDeclaration(patients[i].id as number)
            //             .then(declr => {
            //                 repCount++;
            //                 if(declr) {
            //                     if(user === null) user = patients[i];
            //                     resolve(false);
            //                 } else if(repCount === patients.length) {
            //                     resolve(user === null);
            //                 } //else: continue waiting
            //             });
            //         if(user) break;
            //     }
            //     resolve(repCount === patients.length && user === null);
            // });
        });
        
        return user;
    }
    // async getPatients(pesel: string): Promise<MyDrGetter<MyDrUser>> {
    //     let response = await this.get(MYDR_URL + "/patients/", {pesel: pesel});
    //     const getter = new MyDrGetter<MyDrUser>(MYDR_URL + "/patients/", {pesel: pesel}, this.headers);
    //     getter.next();
    //     if (response.status < 200 || response.status >= 300) {
    //         console.log(...response.headers);
    //         console.log(response.text);
    //         console.log(response.status);
    //         throw new Error("Network response was not OK");
    //     }
    
    //     let resData = (await response.json()) as any;
    //     let count = resData.count;
    //     if(!count || count == 0) return null;
    //     if(count > 1) {
    //         console.warn("Found two MyDR profiles for the same patient with email" + email)
    //     }
    //     let result = (resData.results as Array<any>)[0];
    //     //delete result.pesel;
    //     return result;
    // }
    
    async getFreeSlots(date: string, office?: string|null, department?: string|null) {
        /**
         * {"id":51934,
         * "name":"PORADNIA POŁOŻNICZO-GINEKOLOGICZNA",
         * "regon":"52888165800012","department_code":"56695","departmental_code_7":"001","departmental_code_8":"1450","code_5":"01","nip":"8883168681","telephone":"690 655 792","street":"Zduńska","house_number":"6/12","flat_number":"L.3","postal_code":"87-800","city":"WŁOCŁAWEK","province":"Kujawsko-pomorskie","country":"POLSKA","work_from":"07:00:00","work_to":"21:00:00","mus_code":"001","kids_allowed":false}
         */
        const queryObj:{[key:string]:any} = {date_from: date, date_to: date};
        //const queryObj:{[key:string]:any} = {date: date};
        let dep = department;
        if(!dep && office) {
            //queryObj.office = office;
            dep = officeDepartment[office];
        } 
        // if(dep && !depInitTokenReq[dep]) { //if department is DEFAULT
        //     queryObj.department = dep;
        //     queryObj.visit_duration = 10;
        // }
        queryObj.department = dep;
        queryObj.visit_duration = 15;

        const urlStr = MYDR_URL + "/visits/free_slots/" + "?" + buildUrlQueryData(queryObj);
        const reqInit: RequestInit = {
            method: "GET",
            headers: this.headers
        }
        // let depListRes = await fetch(MYDR_URL + "/departments/", reqInit);
        // let resText = await depListRes.text();
        // console.log("Department List: " + resText);


        console.log("Requesting " + urlStr);
        let res = await fetch(urlStr, reqInit);
        const ok = res.status >= 200 && res.status < 300 ;
        if(!ok) {
            res.text().then((text) => {
                console.log("Failed to fetching request " + urlStr + ", HTTP status: " + res.status + ", " + text);
            })
            
            return {success: false, httpCode: ResultCode.SERVER_ERROR, doctors: [], departments: [], slots: [],
                message: "Nie udało się pobrać wolnych miejsc ze zdalnego serwera"};
        }
        
        const data = (await res.json());
        // let results;
        // if(!office) {
        //     results = data.results;
        // } else {
        //     results = [];
        //     const numResult = data.results ? data.results.length : 0;
        //     for(let i = 0; i < numResult; i++) {
        //         if(data.results[i].office == office) {
        //             results.push(data.results[i]);
        //         }
        //     }
        // }

        return {success: true, httpCode: ResultCode.OK, message: "OK", doctors: data.doctors, departments: data.departments, slots: data.results};//results};
    }
    async makeAppointment(visit: Visit):Promise<Result> {
        let url = MYDR_URL + "/visits/";
        let cfgReq = {
            method: "POST",
            headers: {"Content-Type": "application/json", ...this.headers},
            body: JSON.stringify(visit)
        };
        let response = await fetch(url, cfgReq);
        let ok = response.status >= 200 && response.status < 300
        if (!ok) {
            const resText = await response.text();
            console.log("Failed in makeAppointment: " + resText);
            return {success: false, httpCode: ResultCode.BAD_REQUEST, message: "Nie udało się umówić na spotkanie: nieznany błąd"};
        }
        let resData = await response.json();
        return {success: true, httpCode: ResultCode.OK, message: "OK", visit: resData as Visit};
    }
    async getAppointmentByPk(id: string): Promise<Visit|null> {
        const urlStr = MYDR_URL + "/visits/" + id.toString();
        const reqInit: RequestInit = {
            method: "GET",
            headers: this.headers
        }
        let res = await fetch(urlStr, reqInit);
        let ok = res.status >= 200 && res.status < 300 ;
        if(!ok) {
            console.log("Failed to fetching request " + urlStr + ", HTTP status: " + res.status + ", " + (await res.text))
            return null;
        }
        return (await res.json()) as Visit;
    }
    async cancelAppointment(visit: Visit):Promise<Result> {
        let url = MYDR_URL + "/visits/" + visit.id + "/";
        let cfgReq = {
            method: "PATCH",
            headers: {"Content-Type": "application/json", ...this.headers},
            body: JSON.stringify({patient: visit.patient, doctor: visit.doctor, office: visit.office, date: visit.date, state: "Anulowana"})
        };
        let response = await fetch(url, cfgReq);
        let ok = response.status >= 200 && response.status < 300
        if (!ok) {
            const resText = await response.text();
            console.log("Failed in cancelAppointment: " + resText);
            return {success: false, httpCode: ResultCode.BAD_REQUEST, message: "Nie udało się umówić na spotkanie: nieznany błąd"};
        }
        let resData = await response.json();
        return {success: true, httpCode: ResultCode.OK, message: "OK", visit: resData as Visit};
    }

    async updatePatient(data: any): Promise<Result> {
        if(!data.id) {
            return {success: false, httpCode: ResultCode.BAD_REQUEST, message: "id is required"};
        }
        // let message = "";
        // for(let k in this.requiredColumns) {
        //     if(!data[k]) {
        //         message += k + " is required";
        //     }
        // }        
        // if(message.length > 0) {
        //     return {success: false, httpCode: ResultCode.BAD_REQUEST, message: message};
        // }

        let url = MYDR_URL + "/patients/" + data.id + "/";
        delete data.id;
        let cfgReq = {
            method: "PATCH",
            headers: {"Content-Type": "application/json", ...this.headers},
            body: JSON.stringify(data)
        };
        let response = await fetch(url, cfgReq);
        if (response.status < 200 || response.status >= 300) {
            return {success: false, httpCode: ResultCode.BAD_REQUEST, message: await response.text()};
        }
        let resData = await response.json();
        return {success: true, httpCode: ResultCode.OK, message: "OK", patient: resData as MyDrUser}
    }
    async createPatient(data: any): Promise<Result> {
        let message = "";
        for(let k in this.requiredColumns) {
            const col = this.requiredColumns[k];
            if(data[col] === undefined || data[col] === null) {
                message += col + " is required. ";
            }
        }        
        if(message.length > 0) {
            return {success: false, httpCode: ResultCode.BAD_REQUEST, message: message};
        }

        let url = MYDR_URL + "/patients/";
        delete data.id;
        if(data["identity_type"]) {
            data["identity_type"] = data["identity_type"].toString();
        } else {
            data["identity_type"] = "";
        }
        if(data["country"]) {
            data["country"] = data["country"].toString();
        }
        if(data["rights"]) {
            data["rights"] = data["rights"].toString();
        }
        for(const key in data) {
            if(typeof data[key] === "string" && !data[key]) {
                delete data[key];
            }
        }
        // if(!data["maiden_name"]) {
        //     data["maiden_name"] = "N/A";
        // }
        // if(!data["second_name"]) {
        //     delete data.second_name;
        // }
        const reqBody = JSON.stringify(data);
        //console.log("Requesting MyDR User Create: " + reqBody)
        const cfgReq = {
            method: "POST",
            headers: {"Content-Type": "application/json", ...this.headers},
            body: reqBody
        };
        const response = await fetch(url, cfgReq);
        if (response.status < 200 || response.status >= 300) {
            return {success: false, httpCode: ResultCode.BAD_REQUEST, message: await response.text()};
        }
        const resData = await response.json();
        return {success: true, httpCode: ResultCode.OK, message: "OK", patient: resData as User}
    }
}
/**
export interface Address {
    id: number,
    country: string,
    street: string,
    street_number: string,
    flat_number: string,
    postal_code: string,
    city: string,
    province: string
}
export interface Patient {
    id?: number,
    name: string,
    surname: string,
    telephone?: string,
    second_telephone?: string,
    email: string,
    date_of_birth?: string,
    sex?: string,
    pesel: string,
    identity_type?: string,
    identity_num?: string,
    country?: string,
    supervisor?: 0,
    nfz?: string,
    rights?: string,
    residence_address?: Address,
    second_name?: string,
    maiden_name?: string,
    place_of_birth?: string,
    internal_card_id?: string,
    registration_address?: Address,
    blood_type?: string,
    active?: boolean,
    teryt?: number
}
 */
interface Token {
    expires_in: number,
    access_token: string,
    token_type: string,
    scope: string,
    refresh_token: string
}

const tokenUrl = MYDR_URL + "/o/token/";

//if(!globalThis.myDrToken.) {
    //REFRESH TOKEN: Bearer: GeJdGcYINDWO6bYvxG3963Do2OwXMA, Refresh: WlVOtwD19NdT7L5qSVUqY1gXszS8C3
    //{"access_token": "76D3aJkhbQolmoDjHMrCoLAVYeD9R4", "token_type": "Bearer", "expires_in": 36000, "refresh_token": "gxh3w2u5sDapmAYyYih5Vt6RlpfZjd", "scope": "external_api"}
    // globalThis.myDrToken = {
    //     access_token: "y6McEMa4CxUUdprdBJJML02AIShmxP", 
    //     token_type: "Bearer", 
    //     expires_in: Date.now() + 36000000, 
    //     refresh_token: "BwQx07CQApYhGgdkhvakki4Zkhak5S", 
    //     scope: "external_api"};
//}

async function requestToken(reqBody: object) {
    let cfgReq = {
        method: "POST",
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json'
        },
        body: buildUrlQueryData(reqBody)
    }
    let response = await fetch(tokenUrl, cfgReq);
    if (response.status < 200 || response.status >= 300) {
        throw new Error("Network response was not OK, http status " + response.status + ", message: " + (await response.text()));
    }

    let resToken = await response.json() as Token;
    resToken.expires_in = Date.now() + resToken.expires_in * 1000;
    console.log("Finish fetching token: " + tokenUrl + ". Token: " + resToken.access_token)
    return resToken;
}

if(!globalThis.myDrToken) {
    globalThis.myDrToken = new Map<string, Token>();
}
for(const dep in depInitTokenReq) {
    const token = await requestToken(depInitTokenReq[dep]);
    globalThis.myDrToken.set(dep, token);
}

//adimr52@gmail.com 98112402795
//katarzyna.kuszx@gmail.com 48072843497
