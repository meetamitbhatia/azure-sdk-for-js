// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import * as base64 from "./util/base64";
import * as utils from "./util/utils";

export class Serializer {
  constructor(public readonly modelMappers?: { [key: string]: any }, public readonly isXML?: boolean) { }

  validateConstraints(mapper: Mapper, value: any, objectName: string): void {
    const failValidation = (constraintName: keyof MapperConstraints, constraintValue: any) => {
      throw new Error(`"${objectName}" with value "${value}" should satisfy the constraint "${constraintName}": ${constraintValue}.`);
    };
    if (mapper.constraints && (value != undefined)) {
      const {
        ExclusiveMaximum,
        ExclusiveMinimum,
        InclusiveMaximum,
        InclusiveMinimum,
        MaxItems,
        MaxLength,
        MinItems,
        MinLength,
        MultipleOf,
        Pattern,
        UniqueItems
      } = mapper.constraints;
      if (ExclusiveMaximum != undefined && value >= ExclusiveMaximum) {
        failValidation("ExclusiveMaximum", ExclusiveMaximum);
      }
      if (ExclusiveMinimum != undefined && value <= ExclusiveMinimum) {
        failValidation("ExclusiveMinimum", ExclusiveMinimum);
      }
      if (InclusiveMaximum != undefined && value > InclusiveMaximum) {
        failValidation("InclusiveMaximum", InclusiveMaximum);
      }
      if (InclusiveMinimum != undefined && value < InclusiveMinimum) {
        failValidation("InclusiveMinimum", InclusiveMinimum);
      }
      if (MaxItems != undefined && value.length > MaxItems) {
        failValidation("MaxItems", MaxItems);
      }
      if (MaxLength != undefined && value.length > MaxLength) {
        failValidation("MaxLength", MaxLength);
      }
      if (MinItems != undefined && value.length < MinItems) {
        failValidation("MinItems", MinItems);
      }
      if (MinLength != undefined && value.length < MinLength) {
        failValidation("MinLength", MinLength);
      }
      if (MultipleOf != undefined && value % MultipleOf !== 0) {
        failValidation("MultipleOf", MultipleOf);
      }
      if (Pattern && value.match(Pattern) === null) {
        failValidation("Pattern", Pattern);
      }
      if (UniqueItems && value.some((item: any, i: number, ar: Array<any>) => ar.indexOf(item) !== i)) {
        failValidation("UniqueItems", UniqueItems);
      }
    }
  }

  /**
   * Serialize the given object based on its metadata defined in the mapper
   *
   * @param {Mapper} mapper The mapper which defines the metadata of the serializable object
   *
   * @param {object|string|Array|number|boolean|Date|stream} object A valid Javascript object to be serialized
   *
   * @param {string} objectName Name of the serialized object
   *
   * @returns {object|string|Array|number|boolean|Date|stream} A valid serialized Javascript object
   */
  serialize(mapper: Mapper, object: any, objectName?: string): any {
    let payload: any = {};
    const mapperType = mapper.type.name as string;
    if (!objectName) {
      objectName = mapper.serializedName;
    }
    if (mapperType.match(/^Sequence$/ig) !== null) {
      payload = [];
    }

    if (object == undefined && (mapper.defaultValue != undefined || mapper.isConstant)) {
      object = mapper.defaultValue;
    }

    // This table of allowed values should help explain
    // the mapper.required and mapper.nullable properties.
    // X means "neither undefined or null are allowed".
    //           || required
    //           || true      | false
    //  nullable || ==========================
    //      true || null      | undefined/null
    //     false || X         | undefined
    // undefined || X         | undefined/null

    const { required, nullable } = mapper;

    if (required && nullable && object === undefined) {
      throw new Error(`${objectName} cannot be undefined.`);
    }
    if (required && !nullable && object == undefined) {
      throw new Error(`${objectName} cannot be null or undefined.`);
    }
    if (!required && nullable === false && object === null) {
      throw new Error(`${objectName} cannot be null.`);
    }

    if (object == undefined) {
      payload = object;
    } else {
      // Validate Constraints if any
      this.validateConstraints(mapper, object, objectName);
      if (mapperType.match(/^any$/ig) !== null) {
        payload = object;
      } else if (mapperType.match(/^(Number|String|Boolean|Object|Stream|Uuid)$/ig) !== null) {
        payload = serializeBasicTypes(mapperType, objectName, object);
      } else if (mapperType.match(/^Enum$/ig) !== null) {
        const enumMapper: EnumMapper = mapper as EnumMapper;
        payload = serializeEnumType(objectName, enumMapper.type.allowedValues, object);
      } else if (mapperType.match(/^(Date|DateTime|TimeSpan|DateTimeRfc1123|UnixTime)$/ig) !== null) {
        payload = serializeDateTypes(mapperType, object, objectName);
      } else if (mapperType.match(/^ByteArray$/ig) !== null) {
        payload = serializeByteArrayType(objectName, object);
      } else if (mapperType.match(/^Base64Url$/ig) !== null) {
        payload = serializeBase64UrlType(objectName, object);
      } else if (mapperType.match(/^Sequence$/ig) !== null) {
        payload = serializeSequenceType(this, mapper as SequenceMapper, object, objectName);
      } else if (mapperType.match(/^Dictionary$/ig) !== null) {
        payload = serializeDictionaryType(this, mapper as DictionaryMapper, object, objectName);
      } else if (mapperType.match(/^Composite$/ig) !== null) {
        payload = serializeCompositeType(this, mapper as CompositeMapper, object, objectName);
      }
    }
    return payload;
  }

  /**
   * Deserialize the given object based on its metadata defined in the mapper
   *
   * @param {object} mapper The mapper which defines the metadata of the serializable object
   *
   * @param {object|string|Array|number|boolean|Date|stream} responseBody A valid Javascript entity to be deserialized
   *
   * @param {string} objectName Name of the deserialized object
   *
   * @returns {object|string|Array|number|boolean|Date|stream} A valid deserialized Javascript object
   */
  deserialize(mapper: Mapper, responseBody: any, objectName: string): any {
    if (responseBody == undefined) {
      if (this.isXML && mapper.type.name === "Sequence" && !mapper.xmlIsWrapped) {
        // Edge case for empty XML non-wrapped lists. xml2js can't distinguish
        // between the list being empty versus being missing,
        // so let's do the more user-friendly thing and return an empty list.
        responseBody = [];
      }
      return responseBody;
    }

    let payload: any;
    const mapperType = mapper.type.name;
    if (!objectName) {
      objectName = mapper.serializedName;
    }

    if (mapperType.match(/^Number$/ig) !== null) {
      payload = parseFloat(responseBody);
      if (isNaN(payload)) {
        payload = responseBody;
      }
    } else if (mapperType.match(/^Boolean$/ig) !== null) {
      if (responseBody === "true") {
        payload = true;
      } else if (responseBody === "false") {
        payload = false;
      } else {
        payload = responseBody;
      }
    } else if (mapperType.match(/^(String|Enum|Object|Stream|Uuid|TimeSpan|any)$/ig) !== null) {
      payload = responseBody;
    } else if (mapperType.match(/^(Date|DateTime|DateTimeRfc1123)$/ig) !== null) {
      payload = new Date(responseBody);
    } else if (mapperType.match(/^UnixTime$/ig) !== null) {
      payload = unixTimeToDate(responseBody);
    } else if (mapperType.match(/^ByteArray$/ig) !== null) {
      payload = base64.decodeString(responseBody);
    } else if (mapperType.match(/^Base64Url$/ig) !== null) {
      payload = base64UrlToByteArray(responseBody);
    } else if (mapperType.match(/^Sequence$/ig) !== null) {
      payload = deserializeSequenceType(this, mapper as SequenceMapper, responseBody, objectName);
    } else if (mapperType.match(/^Dictionary$/ig) !== null) {
      payload = deserializeDictionaryType(this, mapper as DictionaryMapper, responseBody, objectName);
    } else if (mapperType.match(/^Composite$/ig) !== null) {
      payload = deserializeCompositeType(this, mapper as CompositeMapper, responseBody, objectName);
    }

    if (mapper.isConstant) {
      payload = mapper.defaultValue;
    }

    return payload;
  }
}

function trimEnd(str: string, ch: string) {
  let len = str.length;
  while ((len - 1) >= 0 && str[len - 1] === ch) {
    --len;
  }
  return str.substr(0, len);
}

function bufferToBase64Url(buffer: any): string | undefined {
  if (!buffer) {
    return undefined;
  }
  if (!(buffer instanceof Uint8Array)) {
    throw new Error(`Please provide an input of type Uint8Array for converting to Base64Url.`);
  }
  // Uint8Array to Base64.
  const str = base64.encodeByteArray(buffer);
  // Base64 to Base64Url.
  return trimEnd(str, "=").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlToByteArray(str: string): Uint8Array | undefined {
  if (!str) {
    return undefined;
  }
  if (str && typeof str.valueOf() !== "string") {
    throw new Error("Please provide an input of type string for converting to Uint8Array");
  }
  // Base64Url to Base64.
  str = str.replace(/\-/g, "+").replace(/\_/g, "/");
  // Base64 to Uint8Array.
  return base64.decodeString(str);
}

function splitSerializeName(prop: string): Array<string> {
  const classes: Array<string> = [];
  let partialclass = "";
  const subwords = prop.split(".");

  for (const item of subwords) {
    if (item.charAt(item.length - 1) === "\\") {
      partialclass += item.substr(0, item.length - 1) + ".";
    } else {
      partialclass += item;
      classes.push(partialclass);
      partialclass = "";
    }
  }

  return classes;
}

function dateToUnixTime(d: string | Date): number | undefined {
  if (!d) {
    return undefined;
  }

  if (typeof d.valueOf() === "string") {
    d = new Date(d as string);
  }
  return Math.floor((d as Date).getTime() / 1000);
}

function unixTimeToDate(n: number): Date | undefined {
  if (!n) {
    return undefined;
  }
  return new Date(n * 1000);
}

function serializeBasicTypes(typeName: string, objectName: string, value: any): any {
  if (value !== null && value !== undefined) {
    if (typeName.match(/^Number$/ig) !== null) {
      if (typeof value !== "number") {
        throw new Error(`${objectName} with value ${value} must be of type number.`);
      }
    } else if (typeName.match(/^String$/ig) !== null) {
      if (typeof value.valueOf() !== "string") {
        throw new Error(`${objectName} with value "${value}" must be of type string.`);
      }
    } else if (typeName.match(/^Uuid$/ig) !== null) {
      if (!(typeof value.valueOf() === "string" && utils.isValidUuid(value))) {
        throw new Error(`${objectName} with value "${value}" must be of type string and a valid uuid.`);
      }
    } else if (typeName.match(/^Boolean$/ig) !== null) {
      if (typeof value !== "boolean") {
        throw new Error(`${objectName} with value ${value} must be of type boolean.`);
      }
    } else if (typeName.match(/^Stream$/ig) !== null) {
      const objectType = typeof value;
      if (objectType !== "string" &&
          objectType !== "function" &&
          !(value instanceof ArrayBuffer) &&
          !ArrayBuffer.isView(value) &&
          !(typeof Blob === "function" && value instanceof Blob)) {
        throw new Error(`${objectName} must be a string, Blob, ArrayBuffer, ArrayBufferView, or a function returning NodeJS.ReadableStream.`);
      }
    }
  }
  return value;
}

function serializeEnumType(objectName: string, allowedValues: Array<any>, value: any): any {
  if (!allowedValues) {
    throw new Error(`Please provide a set of allowedValues to validate ${objectName} as an Enum Type.`);
  }
  const isPresent = allowedValues.some((item) => {
    if (typeof item.valueOf() === "string") {
      return item.toLowerCase() === value.toLowerCase();
    }
    return item === value;
  });
  if (!isPresent) {
    throw new Error(`${value} is not a valid value for ${objectName}. The valid values are: ${JSON.stringify(allowedValues)}.`);
  }
  return value;
}

function serializeByteArrayType(objectName: string, value: any): any {
  if (value != undefined) {
    if (!(value instanceof Uint8Array)) {
      throw new Error(`${objectName} must be of type Uint8Array.`);
    }
    value = base64.encodeByteArray(value);
  }
  return value;
}

function serializeBase64UrlType(objectName: string, value: any): any {
  if (value != undefined) {
    if (!(value instanceof Uint8Array)) {
      throw new Error(`${objectName} must be of type Uint8Array.`);
    }
    value = bufferToBase64Url(value);
  }
  return value;
}

function serializeDateTypes(typeName: string, value: any, objectName: string) {
  if (value != undefined) {
    if (typeName.match(/^Date$/ig) !== null) {
      if (!(value instanceof Date ||
        (typeof value.valueOf() === "string" && !isNaN(Date.parse(value))))) {
        throw new Error(`${objectName} must be an instanceof Date or a string in ISO8601 format.`);
      }
      value = (value instanceof Date) ? value.toISOString().substring(0, 10) : new Date(value).toISOString().substring(0, 10);
    } else if (typeName.match(/^DateTime$/ig) !== null) {
      if (!(value instanceof Date ||
        (typeof value.valueOf() === "string" && !isNaN(Date.parse(value))))) {
        throw new Error(`${objectName} must be an instanceof Date or a string in ISO8601 format.`);
      }
      value = (value instanceof Date) ? value.toISOString() : new Date(value).toISOString();
    } else if (typeName.match(/^DateTimeRfc1123$/ig) !== null) {
      if (!(value instanceof Date ||
        (typeof value.valueOf() === "string" && !isNaN(Date.parse(value))))) {
        throw new Error(`${objectName} must be an instanceof Date or a string in RFC-1123 format.`);
      }
      value = (value instanceof Date) ? value.toUTCString() : new Date(value).toUTCString();
    } else if (typeName.match(/^UnixTime$/ig) !== null) {
      if (!(value instanceof Date ||
        (typeof value.valueOf() === "string" && !isNaN(Date.parse(value))))) {
        throw new Error(`${objectName} must be an instanceof Date or a string in RFC-1123/ISO8601 format ` +
          `for it to be serialized in UnixTime/Epoch format.`);
      }
      value = dateToUnixTime(value);
    } else if (typeName.match(/^TimeSpan$/ig) !== null) {
      if (!utils.isDuration(value)) {
        throw new Error(`${objectName} must be a string in ISO 8601 format. Instead was "${value}".`);
      }
      value = value;
    }
  }
  return value;
}

function serializeSequenceType(serializer: Serializer, mapper: SequenceMapper, object: any, objectName: string) {
  if (!Array.isArray(object)) {
    throw new Error(`${objectName} must be of type Array.`);
  }
  const elementType = mapper.type.element;
  if (!elementType || typeof elementType !== "object") {
    throw new Error(`element" metadata for an Array must be defined in the ` +
      `mapper and it must of type "object" in ${objectName}.`);
  }
  const tempArray = [];
  for (let i = 0; i < object.length; i++) {
    tempArray[i] = serializer.serialize(elementType, object[i], objectName);
  }
  return tempArray;
}

function serializeDictionaryType(serializer: Serializer, mapper: DictionaryMapper, object: any, objectName: string) {

  if (typeof object !== "object") {
    throw new Error(`${objectName} must be of type object.`);
  }
  const valueType = mapper.type.value;
  if (!valueType || typeof valueType !== "object") {
    throw new Error(`"value" metadata for a Dictionary must be defined in the ` +
      `mapper and it must of type "object" in ${objectName}.`);
  }
  const tempDictionary: { [key: string]: any } = {};
  for (const key of Object.keys(object)) {
    tempDictionary[key] = serializer.serialize(valueType, object[key], objectName + "." + key);
  }
  return tempDictionary;
}

function serializeCompositeType(serializer: Serializer, mapper: CompositeMapper, object: any, objectName: string) {
  // check for polymorphic discriminator
  if (mapper.type.polymorphicDiscriminator) {
    mapper = getPolymorphicMapper(serializer, mapper, object, objectName, "serialize");
  }

  const payload: any = {};
  let modelMapper: CompositeMapper = {
    required: false,
    serializedName: "serializedName",
    type: {
      name: "Composite",
      className: "className",
      modelProperties: {}
    }
  };
  if (object != undefined) {
    let modelProps = mapper.type.modelProperties;
    if (!modelProps) {
      const className = mapper.type.className;
      if (!className) {
        throw new Error(`Class name for model "${objectName}" is not provided in the mapper "${JSON.stringify(mapper, undefined, 2)}".`);
      }
      // get the mapper if modelProperties of the CompositeType is not present and
      // then get the modelProperties from it.
      modelMapper = (serializer.modelMappers as { [key: string]: any })[className];
      if (!modelMapper) {
        throw new Error(`mapper() cannot be null or undefined for model "${className}".`);
      }
      modelProps = modelMapper.type.modelProperties;
      if (!modelProps) {
        throw new Error(`modelProperties cannot be null or undefined in the ` +
          `mapper "${JSON.stringify(modelMapper)}" of type "${className}" for object "${objectName}".`);
      }
    }

    for (const key of Object.keys(modelProps)) {
      const propertyMapper = modelProps[key];

      let propName: string | undefined;
      let parentObject: any = payload;
      if (serializer.isXML) {
        if (propertyMapper.xmlIsWrapped) {
          propName = propertyMapper.xmlName;
        } else {
          propName = propertyMapper.xmlElementName || propertyMapper.xmlName;
        }
      } else {
        const paths = splitSerializeName(propertyMapper.serializedName);
        propName = paths.pop();

        for (const pathName of paths) {
          const childObject = parentObject[pathName];
          if ((childObject == undefined) && (object[key] != undefined)) {
            parentObject[pathName] = {};
          }
          parentObject = parentObject[pathName];
        }
      }

      // make sure that readOnly properties are not sent on the wire
      if (propertyMapper.readOnly) {
        continue;
      }

      if (parentObject != undefined) {
        const propertyObjectName = propertyMapper.serializedName !== ""
          ? objectName + "." + propertyMapper.serializedName
          : objectName;

        const serializedValue = serializer.serialize(propertyMapper, object[key], propertyObjectName);
        if (serializedValue !== undefined && propName != undefined) {
          if (propertyMapper.xmlIsAttribute) {
            // $ is the key attributes are kept under in xml2js.
            // This keeps things simple while preventing name collision
            // with names in user documents.
            parentObject.$ = parentObject.$ || {};
            parentObject.$[propName] = serializedValue;
          } else if (propertyMapper.xmlIsWrapped) {
            parentObject[propName] = { [propertyMapper.xmlElementName!]: serializedValue };
          } else {
            parentObject[propName] = serializedValue;
          }
        }
      }
    }
    return payload;
  }
  return object;
}

function deserializeCompositeType(serializer: Serializer, mapper: CompositeMapper, responseBody: any, objectName: string): any {
  /*jshint validthis: true */
  if (mapper.type.polymorphicDiscriminator) {
    mapper = getPolymorphicMapper(serializer, mapper, responseBody, objectName, "deserialize");
  }

  let instance: { [key: string]: any } = {};
  let modelMapper: Mapper = {
    required: false,
    serializedName: "serializedName",
    type: {
      name: "Composite"
    }
  };
  responseBody = responseBody || {};
  let modelProps = mapper.type.modelProperties;
  if (!modelProps) {
    if (!mapper.type.className) {
      throw new Error(`Class name for model "${objectName}" is not provided in the mapper "${JSON.stringify(mapper)}"`);
    }
    // get the mapper if modelProperties of the CompositeType is not present and
    // then get the modelProperties from it.
    modelMapper = (serializer.modelMappers as { [key: string]: any })[mapper.type.className];
    if (!modelMapper) {
      throw new Error(`mapper() cannot be null or undefined for model "${mapper.type.className}"`);
    }
    modelProps = (modelMapper as CompositeMapper).type.modelProperties;
    if (!modelProps) {
      throw new Error(`modelProperties cannot be null or undefined in the ` +
        `mapper "${JSON.stringify(modelMapper)}" of type "${mapper.type.className}" for responseBody "${objectName}".`);
    }
  }

  for (const key of Object.keys(modelProps)) {
    const propertyMapper = modelProps[key];
    let propertyObjectName = objectName;
    if (propertyMapper.serializedName !== "") {
      propertyObjectName = objectName + "." + propertyMapper.serializedName;
    }

    const headerCollectionPrefix = (propertyMapper as DictionaryMapper).headerCollectionPrefix;
    if (headerCollectionPrefix) {
      const dictionary: any = {};
      for (const headerKey of Object.keys(responseBody)) {
        if (headerKey.startsWith(headerCollectionPrefix)) {
          dictionary[headerKey.substring(headerCollectionPrefix.length)] = serializer.deserialize((propertyMapper as DictionaryMapper).type.value, responseBody[headerKey], propertyObjectName);
        }
      }
      instance[key] = dictionary;
    } else if (serializer.isXML) {
      if (propertyMapper.xmlIsAttribute && responseBody.$) {
        instance[key] = serializer.deserialize(propertyMapper, responseBody.$[propertyMapper.xmlName!], propertyObjectName);
      } else {
        const propertyName = propertyMapper.xmlElementName || propertyMapper.xmlName;
        let unwrappedProperty = responseBody[propertyName!];
        if (propertyMapper.xmlIsWrapped) {
          unwrappedProperty = responseBody[propertyMapper.xmlName!];
          unwrappedProperty = unwrappedProperty && unwrappedProperty[propertyMapper.xmlElementName!];
          if (unwrappedProperty === undefined) {
            // undefined means a wrapped list was empty
            unwrappedProperty = [];
          }
        }
        instance[key] = serializer.deserialize(propertyMapper, unwrappedProperty, propertyObjectName);
      }
    } else {
      const paths = splitSerializeName(modelProps[key].serializedName);
      // deserialize the property if it is present in the provided responseBody instance
      let propertyInstance;
      let res = responseBody;
      // traversing the object step by step.
      for (const item of paths) {
        if (!res) break;
        res = res[item];
      }
      propertyInstance = res;
      let serializedValue;
      // paging
      if (Array.isArray(responseBody[key]) && modelProps[key].serializedName === "") {
        propertyInstance = responseBody[key];
        instance = serializer.deserialize(propertyMapper, propertyInstance, propertyObjectName);
      } else if (propertyInstance !== undefined) {
        serializedValue = serializer.deserialize(propertyMapper, propertyInstance, propertyObjectName);
        instance[key] = serializedValue;
      }
    }
  }
  return instance;
}

function deserializeDictionaryType(serializer: Serializer, mapper: DictionaryMapper, responseBody: any, objectName: string): any {
  /*jshint validthis: true */
  const value = mapper.type.value;
  if (!value || typeof value !== "object") {
    throw new Error(`"value" metadata for a Dictionary must be defined in the ` +
      `mapper and it must of type "object" in ${objectName}`);
  }
  if (responseBody) {
    const tempDictionary: { [key: string]: any } = {};
    for (const key of Object.keys(responseBody)) {
      tempDictionary[key] = serializer.deserialize(value, responseBody[key], objectName);
    }
    return tempDictionary;
  }
  return responseBody;
}

function deserializeSequenceType(serializer: Serializer, mapper: SequenceMapper, responseBody: any, objectName: string): any {
  /*jshint validthis: true */
  const element = mapper.type.element;
  if (!element || typeof element !== "object") {
    throw new Error(`element" metadata for an Array must be defined in the ` +
      `mapper and it must of type "object" in ${objectName}`);
  }
  if (responseBody) {
    if (!Array.isArray(responseBody)) {
      // xml2js will interpret a single element array as just the element, so force it to be an array
      responseBody = [responseBody];
    }

    const tempArray = [];
    for (let i = 0; i < responseBody.length; i++) {
      tempArray[i] = serializer.deserialize(element, responseBody[i], objectName);
    }
    return tempArray;
  }
  return responseBody;
}

function getPolymorphicMapper(serializer: Serializer, mapper: CompositeMapper, object: any, objectName: string, mode: string): CompositeMapper {

  // check for polymorphic discriminator
  // Until version 1.15.1, "polymorphicDiscriminator" in the mapper was a string. This method was not effective when the
  // polymorphicDiscriminator property had a dot in it"s name. So we have comeup with a desgin where polymorphicDiscriminator
  // will be an object that contains the clientName (normalized property name, ex: "odatatype") and
  // the serializedName (ex: "odata.type") (We do not escape the dots with double backslash in this case as it is not required)
  // Thus when serializing, the user will give us an object which will contain the normalizedProperty hence we will lookup
  // the clientName of the polymorphicDiscriminator in the mapper and during deserialization from the responseBody we will
  // lookup the serializedName of the polymorphicDiscriminator in the mapper. This will help us in selecting the correct mapper
  // for the model that needs to be serializes or deserialized.
  // We need this routing for backwards compatibility. This will absorb the breaking change in the mapper and allow new versions
  // of the runtime to work seamlessly with older version (>= 0.17.0-Nightly20161008) of Autorest generated node.js clients.
  const polymorphicDiscriminator = mapper.type.polymorphicDiscriminator;
  if (polymorphicDiscriminator) {
    if (typeof polymorphicDiscriminator.valueOf() === "string") {
      return getPolymorphicMapperStringVersion(serializer, mapper, object, objectName);
    } else if (polymorphicDiscriminator instanceof Object) {
      return getPolymorphicMapperObjectVersion(serializer, mapper, object, objectName, mode);
    } else {
      throw new Error(`The polymorphicDiscriminator for "${objectName}" is neither a string nor an object.`);
    }
  }
  return mapper;
}

// processes new version of the polymorphicDiscriminator in the mapper.
function getPolymorphicMapperObjectVersion(serializer: Serializer, mapper: CompositeMapper, object: any, objectName: string, mode: string): CompositeMapper {

  // check for polymorphic discriminator
  let polymorphicPropertyName = "";
  if (mode === "serialize") {
    polymorphicPropertyName = "clientName";
  } else if (mode === "deserialize") {
    polymorphicPropertyName = "serializedName";
  } else {
    throw new Error(`The given mode "${mode}" for getting the polymorphic mapper for "${objectName}" is inavlid.`);
  }
  const discriminatorAsObject: PolymorphicDiscriminator = mapper.type.polymorphicDiscriminator as PolymorphicDiscriminator;

  if (discriminatorAsObject &&
    discriminatorAsObject[polymorphicPropertyName] !== null &&
    discriminatorAsObject[polymorphicPropertyName] !== undefined) {
    if (object === null || object === undefined) {
      throw new Error(`${objectName}" cannot be null or undefined. ` +
        `"${discriminatorAsObject[polymorphicPropertyName]}" is the ` +
        `polymorphicDiscriminator is a required property.`);
    }
    if (object[discriminatorAsObject[polymorphicPropertyName]] === null ||
      object[discriminatorAsObject[polymorphicPropertyName]] === undefined) {
      throw new Error(`No discriminator field "${discriminatorAsObject[polymorphicPropertyName]}" was found in "${objectName}".`);
    }
    let indexDiscriminator = undefined;
    if (object[discriminatorAsObject[polymorphicPropertyName]] === mapper.type.uberParent) {
      indexDiscriminator = object[discriminatorAsObject[polymorphicPropertyName]];
    } else {
      indexDiscriminator = mapper.type.uberParent + "." + object[discriminatorAsObject[polymorphicPropertyName]];
    }
    if (serializer.modelMappers && serializer.modelMappers.discriminators[indexDiscriminator]) {
      mapper = serializer.modelMappers.discriminators[indexDiscriminator];
    }
  }
  return mapper;
}

// processes old version of the polymorphicDiscriminator in the mapper.
function getPolymorphicMapperStringVersion(serializer: Serializer, mapper: CompositeMapper, object: any, objectName: string): CompositeMapper {
  // check for polymorphic discriminator
  const discriminatorAsString: string = mapper.type.polymorphicDiscriminator as string;
  if (discriminatorAsString != undefined) {
    if (object == undefined) {
      throw new Error(`${objectName}" cannot be null or undefined. "${discriminatorAsString}" is the ` +
        `polymorphicDiscriminator is a required property.`);
    }
    if (object[discriminatorAsString] == undefined) {
      throw new Error(`No discriminator field "${discriminatorAsString}" was found in "${objectName}".`);
    }
    let indexDiscriminator = undefined;
    if (object[discriminatorAsString] === mapper.type.uberParent) {
      indexDiscriminator = object[discriminatorAsString];
    } else {
      indexDiscriminator = mapper.type.uberParent + "." + object[discriminatorAsString];
    }
    if (serializer.modelMappers && serializer.modelMappers.discriminators[indexDiscriminator]) {
      mapper = serializer.modelMappers.discriminators[indexDiscriminator];
    }
  }

  return mapper;
}

export interface MapperConstraints {
  InclusiveMaximum?: number;
  ExclusiveMaximum?: number;
  InclusiveMinimum?: number;
  ExclusiveMinimum?: number;
  MaxLength?: number;
  MinLength?: number;
  Pattern?: RegExp;
  MaxItems?: number;
  MinItems?: number;
  UniqueItems?: true;
  MultipleOf?: number;
}

export interface BaseMapperType {
  name: string;
}

export interface BaseMapper {
  xmlName?: string;
  xmlIsAttribute?: boolean;
  xmlElementName?: string;
  xmlIsWrapped?: boolean;
  readOnly?: boolean;
  isConstant?: boolean;
  required?: boolean;
  nullable?: boolean;
  serializedName: string;
  type: BaseMapperType;
  defaultValue?: any;
  constraints?: MapperConstraints;
}

export type Mapper = BaseMapper | CompositeMapper | SequenceMapper | DictionaryMapper | EnumMapper;

export interface PolymorphicDiscriminator {
  serializedName: string;
  clientName: string;
  [key: string]: string;
}

export interface CompositeMapper extends BaseMapper {
  type: {
    name: "Composite";
    className: string;
    modelProperties: { [propertyName: string]: Mapper };
    uberParent?: string;
    polymorphicDiscriminator?: string | PolymorphicDiscriminator;
  };
}

export interface SequenceMapper extends BaseMapper {
  type: {
    name: "Sequence";
    element: Mapper;
  };
}

export interface DictionaryMapper extends BaseMapper {
  type: {
    name: "Dictionary";
    value: Mapper;
  };
  headerCollectionPrefix?: string;
}

export interface EnumMapper extends BaseMapper {
  type: {
    name: "Enum";
    allowedValues: Array<any>;
  };
}

export interface UrlParameterValue {
  value: string;
  skipUrlEncoding: boolean;
}

// TODO: why is this here?
export function serializeObject(toSerialize: any): any {
  if (toSerialize == undefined) return undefined;
  if (toSerialize instanceof Uint8Array) {
    toSerialize = base64.encodeByteArray(toSerialize);
    return toSerialize;
  }
  else if (toSerialize instanceof Date) {
    return toSerialize.toISOString();
  }
  else if (Array.isArray(toSerialize)) {
    const array = [];
    for (let i = 0; i < toSerialize.length; i++) {
      array.push(serializeObject(toSerialize[i]));
    }
    return array;
  } else if (typeof toSerialize === "object") {
    const dictionary: { [key: string]: any } = {};
    for (const property in toSerialize) {
      dictionary[property] = serializeObject(toSerialize[property]);
    }
    return dictionary;
  }
  return toSerialize;
}

/**
 * Utility function to create a K:V from a list of strings
 */
function strEnum<T extends string>(o: Array<T>): { [K in T]: K } {
  const result: any = {};
  for (const key of o) {
    result[key] = key;
  }
  return result;
}

export const MapperType = strEnum([
  "Base64Url",
  "Boolean",
  "ByteArray",
  "Composite",
  "Date",
  "DateTime",
  "DateTimeRfc1123",
  "Dictionary",
  "Enum",
  "Number",
  "Object",
  "Sequence",
  "String",
  "Stream",
  "TimeSpan",
  "UnixTime"
]);